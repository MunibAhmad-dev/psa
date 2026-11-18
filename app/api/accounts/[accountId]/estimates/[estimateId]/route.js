const { NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/rbac');
const { logger } = require('@/lib/debug-logger');

const PERM = { VIEW: 'view_estimates', MANAGE: 'manage_estimates' };

const VALID_TRANSITIONS = {
  draft:    ['sent'],
  sent:     ['accepted', 'rejected'],
  accepted: [],
  rejected: [],
};

async function resolveContext(request, accountId) {
  const user = await getUserFromRequest(request);
  if (!user) throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  if (!admin) throw NextResponse.json({ error: 'Database connection failed' }, { status: 500 });

  const { data: userProfile } = await admin
    .from('user_profiles')
    .select('*, user_roles!user_id(roles!role_id(id, name, permissions, department_id))')
    .eq('id', user.id)
    .single();

  if (!userProfile) throw NextResponse.json({ error: 'User profile not found' }, { status: 404 });

  const isSuperadmin = userProfile.is_superadmin ||
    userProfile.user_roles?.some(ur => ur.roles?.name === 'Superadmin');

  if (!isSuperadmin) {
    const { data: membership } = await admin
      .from('account_members')
      .select('id')
      .eq('account_id', accountId)
      .eq('user_id', user.id)
      .is('removed_at', null)
      .maybeSingle();

    if (!membership) throw NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return { userProfile, admin };
}

/**
 * GET /api/accounts/[accountId]/estimates/[estimateId]
 */
async function GET(request, { params }) {
  const { accountId, estimateId } = await params;
  try {
    const { userProfile, admin } = await resolveContext(request, accountId);

    const canView = await hasPermission(userProfile, PERM.VIEW, undefined, admin);
    if (!canView) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

    const { data: estimate, error } = await admin
      .from('estimates')
      .select('*, estimate_line_items(*)')
      .eq('id', estimateId)
      .eq('account_id', accountId)   // tenancy gate
      .is('deleted_at', null)
      .single();

    if (error || !estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, estimate });
  } catch (response) {
    if (response instanceof Response) return response;
    logger.error('Error in GET estimate', { estimateId }, response);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/accounts/[accountId]/estimates/[estimateId]
 * Handles two distinct operations:
 *   - status transition: { action: 'transition', status: 'sent'|'accepted'|'rejected' }
 *   - soft delete:       { action: 'delete' }  (draft only)
 */
async function PATCH(request, { params }) {
  const { accountId, estimateId } = await params;
  try {
    const { userProfile, admin } = await resolveContext(request, accountId);

    const canManage = await hasPermission(userProfile, PERM.MANAGE, undefined, admin);
    if (!canManage) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

    const { data: estimate, error: fetchError } = await admin
      .from('estimates')
      .select('id, status, account_id')
      .eq('id', estimateId)
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .single();

    if (fetchError || !estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }

    let body;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { action, status: nextStatus } = body;

    if (action === 'delete') {
      if (estimate.status !== 'draft') {
        return NextResponse.json(
          { error: 'Only draft estimates can be deleted' },
          { status: 422 },
        );
      }
      await admin.from('estimates').update({ deleted_at: new Date().toISOString() }).eq('id', estimateId);
      return NextResponse.json({ success: true });
    }

    if (action === 'transition') {
      const allowed = VALID_TRANSITIONS[estimate.status] ?? [];
      if (!allowed.includes(nextStatus)) {
        return NextResponse.json(
          { error: `Cannot transition from '${estimate.status}' to '${nextStatus}'` },
          { status: 422 },
        );
      }

      const timestampField = { sent: 'sent_at', accepted: 'accepted_at', rejected: 'rejected_at' }[nextStatus];
      const patch = { status: nextStatus, [timestampField]: new Date().toISOString() };

      const { data: updated, error: updateError } = await admin
        .from('estimates')
        .update(patch)
        .eq('id', estimateId)
        .select('*, estimate_line_items(*)')
        .single();

      if (updateError) {
        logger.error('Failed to transition estimate', { estimateId, nextStatus }, updateError);
        return NextResponse.json({ error: 'Failed to update estimate' }, { status: 500 });
      }

      logger.info('Estimate status changed', { estimateId, from: estimate.status, to: nextStatus });
      return NextResponse.json({ success: true, estimate: updated });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (response) {
    if (response instanceof Response) return response;
    logger.error('Error in PATCH estimate', { estimateId }, response);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

exports.GET   = GET;
exports.PATCH = PATCH;
