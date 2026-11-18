'use client';

import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import Link from 'next/link';
import { Plus, FileText, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  sort_order: number;
}

interface Estimate {
  id: string;
  title: string;
  status: 'draft' | 'sent' | 'accepted' | 'rejected';
  notes: string | null;
  project_id: string | null;
  created_at: string;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  estimate_line_items: LineItem[];
}

const fetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error('Failed to fetch');
  return r.json();
});

const STATUS_LABELS: Record<string, string> = {
  draft:    'Draft',
  sent:     'Sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

const STATUS_CLASSES: Record<string, string> = {
  draft:    'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  sent:     'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  accepted: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

function totalCents(items: LineItem[]): number {
  return items.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export default function EstimatesPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState('');

  const url = `/api/accounts/${accountId}/estimates${statusFilter ? `?status=${statusFilter}` : ''}`;
  const { data, error, mutate } = useSWR<{ estimates: Estimate[] }>(url, fetcher);

  async function sendEstimate(estimateId: string) {
    const res = await fetch(`/api/accounts/${accountId}/estimates/${estimateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'transition', status: 'sent' }),
    });
    if (res.ok) { toast.success('Estimate marked as sent'); mutate(); }
    else toast.error('Failed to update estimate');
  }

  async function deleteEstimate(estimateId: string) {
    const res = await fetch(`/api/accounts/${accountId}/estimates/${estimateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    });
    if (res.ok) { toast.success('Estimate deleted'); mutate(); }
    else toast.error('Failed to delete estimate');
  }

  if (error) return <div className="p-6 text-red-500">Failed to load estimates.</div>;

  const estimates = data?.estimates ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Estimates</h1>
          <p className="text-sm text-zinc-500 mt-1">Manage quotes and proposals for this account</p>
        </div>
        <Link
          href={`/accounts/${accountId}/estimates/new`}
          className="inline-flex items-center gap-2 rounded-md bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Estimate
        </Link>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {['', 'draft', 'sent', 'accepted', 'rejected'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              statusFilter === s
                ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-500'
            }`}
          >
            {s ? STATUS_LABELS[s] : 'All'}
          </button>
        ))}
      </div>

      {!data ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : estimates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center">
          <FileText className="mx-auto h-10 w-10 text-zinc-400 mb-3" />
          <p className="text-sm text-zinc-500">No estimates yet</p>
          <Link
            href={`/accounts/${accountId}/estimates/new`}
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-zinc-900 dark:text-zinc-100 underline underline-offset-2"
          >
            Create your first estimate
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800">
          {estimates.map(est => (
            <div
              key={est.id}
              className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors group"
            >
              <div className="flex items-start gap-4 min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate">
                      {est.title}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASSES[est.status]}`}>
                      {STATUS_LABELS[est.status]}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {est.estimate_line_items.length} line item{est.estimate_line_items.length !== 1 ? 's' : ''} ·{' '}
                    {formatMoney(totalCents(est.estimate_line_items))} ·{' '}
                    Created {new Date(est.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {est.status === 'draft' && (
                  <>
                    <button
                      onClick={() => sendEstimate(est.id)}
                      className="text-xs px-3 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                      Mark Sent
                    </button>
                    <button
                      onClick={() => deleteEstimate(est.id)}
                      className="text-xs px-3 py-1 rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 transition-colors"
                    >
                      Delete
                    </button>
                  </>
                )}
                {est.status === 'sent' && (
                  <>
                    <button
                      onClick={() => fetch(`/api/accounts/${accountId}/estimates/${est.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'transition', status: 'accepted' }),
                      }).then(() => { toast.success('Estimate accepted'); mutate(); })}
                      className="text-xs px-3 py-1 rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => fetch(`/api/accounts/${accountId}/estimates/${est.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'transition', status: 'rejected' }),
                      }).then(() => { toast.success('Estimate rejected'); mutate(); })}
                      className="text-xs px-3 py-1 rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 transition-colors"
                    >
                      Reject
                    </button>
                  </>
                )}
                <ChevronRight className="h-4 w-4 text-zinc-400" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
