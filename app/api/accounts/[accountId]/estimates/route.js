const { NextResponse } = require('next/server');
const { getUserFromRequest, createAdminSupabaseClient } = require('@/lib/supabase-server');
const { hasPermission } = require('@/lib/rbac');
const { logger } = require('@/lib/debug-logger');

// Permission strings — mirrors the JSONB keys in the roles table
const PERM = {
  VIEW:   'view_estimates',
  MANAGE: 'manage_estimates',
};

/**
 * Resolve the caller's profile + verify they belong to this account.
 * Returns { userProfile, admin } or throws with an appropriate NextResponse.
 */
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

  // Superadmins bypass tenancy checks
  const isSuperadmin = userProfile.is_superadmin ||
    userProfile.user_roles?.some(ur => ur.roles?.name === 'Superadmin');

  if (!isSuperadmin) {
    // Confirm caller is a member of this account
    const { data: membership } = await admin
      .from('account_members')
      .select('id')
      .eq('account_id', accountId)
      .eq('user_id', user.id)
      .is('removed_at', null)
      .maybeSingle();

    if (!membership) {
      throw NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  return { userProfile, admin, user };
}

/**
 * GET /api/accounts/[accountId]/estimates
 * Query params: status, project_id, page (default 1), per_page (default 25)
 */
async function GET(request, { params }) {
  const { accountId } = await params;
  try {
    const { userProfile, admin } = await resolveContext(request, accountId);

    const canView = await hasPermission(userProfile, PERM.VIEW, undefined, admin);
    if (!canView) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const url = new URL(request.url);
    const status     = url.searchParams.get('status');
    const projectId  = url.searchParams.get('project_id');
    const page       = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const perPage    = Math.min(100, Math.max(1, parseInt(url.searchParams.get('per_page') ?? '25', 10)));
    const from       = (page - 1) * perPage;

    let query = admin
      .from('estimates')
      .select('*, estimate_line_items(*)', { count: 'exact' })
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(from, from + perPage - 1);

    if (status)    query = query.eq('status', status);
    if (projectId) query = query.eq('project_id', projectId);

    const { data: estimates, count, error } = await query;

    if (error) {
      logger.error('Failed to fetch estimates', { action: 'list_estimates', accountId }, error);
      return NextResponse.json({ error: 'Failed to fetch estimates' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      estimates,
      pagination: { page, per_page: perPage, total: count ?? 0 },
    });
  } catch (response) {
    if (response instanceof Response) return response;
    logger.error('Error in GET /api/accounts/[accountId]/estimates', {}, response);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/accounts/[accountId]/estimates
 * Supports Idempotency-Key header — returns existing estimate if key was already used.
 * Body: { title, notes?, project_id?, line_items: [{ description, quantity, unit_price_cents, sort_order? }] }
 */
async function POST(request, { params }) {
  const { accountId } = await params;
  try {
    const { userProfile, admin, user } = await resolveContext(request, accountId);

    const canManage = await hasPermission(userProfile, PERM.MANAGE, undefined, admin);
    if (!canManage) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const idempotencyKey = request.headers.get('Idempotency-Key') ?? null;

    // Return existing estimate if this key was already used
    if (idempotencyKey) {
      const { data: existing } = await admin
        .from('estimates')
        .select('*, estimate_line_items(*)')
        .eq('idempotency_key', idempotencyKey)
        .eq('account_id', accountId)
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ success: true, estimate: existing }, { status: 200 });
      }
    }

    let body;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { title, notes, project_id, line_items } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: 'title is required' }, { status: 422 });
    }
    if (!Array.isArray(line_items) || line_items.length === 0) {
      return NextResponse.json({ error: 'At least one line item is required' }, { status: 422 });
    }

    // Validate each line item — amounts must be non-negative integers
    for (const item of line_items) {
      if (!item.description?.trim()) {
        return NextResponse.json({ error: 'Each line item must have a description' }, { status: 422 });
      }
      if (!Number.isInteger(item.unit_price_cents) || item.unit_price_cents < 0) {
        return NextResponse.json(
          { error: 'unit_price_cents must be a non-negative integer (minor units)' },
          { status: 422 },
        );
      }
      if (typeof item.quantity !== 'number' || item.quantity <= 0) {
        return NextResponse.json({ error: 'quantity must be a positive number' }, { status: 422 });
      }
    }

    // If project_id supplied, verify it belongs to this account
    if (project_id) {
      const { data: project } = await admin
        .from('projects')
        .select('id')
        .eq('id', project_id)
        .eq('account_id', accountId)
        .maybeSingle();

      if (!project) {
        return NextResponse.json({ error: 'project_id not found in this account' }, { status: 422 });
      }
    }

    const { data: estimate, error: estimateError } = await admin
      .from('estimates')
      .insert({
        account_id:      accountId,
        project_id:      project_id ?? null,
        title:           title.trim(),
        notes:           notes?.trim() ?? null,
        status:          'draft',
        idempotency_key: idempotencyKey,
        created_by:      user.id,
      })
      .select()
      .single();

    if (estimateError) {
      logger.error('Failed to create estimate', { action: 'create_estimate', accountId }, estimateError);
      return NextResponse.json({ error: 'Failed to create estimate' }, { status: 500 });
    }

    const lineItemRows = line_items.map((item, idx) => ({
      estimate_id:      estimate.id,
      description:      item.description.trim(),
      quantity:         item.quantity,
      unit_price_cents: item.unit_price_cents,
      sort_order:       item.sort_order ?? idx,
    }));

    const { data: createdLineItems, error: lineItemError } = await admin
      .from('estimate_line_items')
      .insert(lineItemRows)
      .select();

    if (lineItemError) {
      // Roll back the estimate header to avoid orphaned rows
      await admin.from('estimates').delete().eq('id', estimate.id);
      logger.error('Failed to create line items', { action: 'create_estimate', estimateId: estimate.id }, lineItemError);
      return NextResponse.json({ error: 'Failed to create line items' }, { status: 500 });
    }

    logger.info('Estimate created', { action: 'create_estimate', estimateId: estimate.id, accountId });
    return NextResponse.json(
      { success: true, estimate: { ...estimate, estimate_line_items: createdLineItems } },
      { status: 201 },
    );
  } catch (response) {
    if (response instanceof Response) return response;
    logger.error('Error in POST /api/accounts/[accountId]/estimates', {}, response);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

exports.GET  = GET;
exports.POST = POST;
