'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { Plus, Trash2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { EstimateLineItemEditor, LineItemDraft } from '@/components/estimates/EstimateLineItemEditor';

export default function NewEstimatePage() {
  const { accountId } = useParams<{ accountId: string }>();
  const router = useRouter();

  const [title, setTitle]   = useState('');
  const [notes, setNotes]   = useState('');
  const [items, setItems]   = useState<LineItemDraft[]>([
    { id: uuidv4(), description: '', quantity: 1, unit_price_cents: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const addItem = useCallback(() => {
    setItems(prev => [...prev, { id: uuidv4(), description: '', quantity: 1, unit_price_cents: 0 }]);
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<LineItemDraft>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  }, []);

  const totalCents = items.reduce((s, i) => s + i.unit_price_cents * i.quantity, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { toast.error('Title is required'); return; }
    if (items.some(i => !i.description.trim())) {
      toast.error('All line items need a description');
      return;
    }

    setSubmitting(true);
    // Client-generated idempotency key — safe to retry on network failure
    const idempotencyKey = uuidv4();

    try {
      const res = await fetch(`/api/accounts/${accountId}/estimates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          title: title.trim(),
          notes: notes.trim() || undefined,
          line_items: items.map((item, idx) => ({
            description:      item.description.trim(),
            quantity:         item.quantity,
            unit_price_cents: item.unit_price_cents,
            sort_order:       idx,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to create estimate');
        return;
      }

      toast.success('Estimate created');
      router.push(`/accounts/${accountId}/estimates`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/accounts/${accountId}/estimates`}
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">New Estimate</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Header fields */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Website Redesign Q1 2025"
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Optional notes visible to the account team"
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500 resize-none"
            />
          </div>
        </div>

        {/* Line items */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Line Items</h2>
            <span className="text-xs text-zinc-500">{items.length} item{items.length !== 1 ? 's' : ''}</span>
          </div>

          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {items.map((item, idx) => (
              <EstimateLineItemEditor
                key={item.id}
                item={item}
                index={idx}
                onChange={patch => updateItem(item.id, patch)}
                onRemove={items.length > 1 ? () => removeItem(item.id) : undefined}
              />
            ))}
          </div>

          <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add line item
            </button>
            <div className="text-right">
              <p className="text-xs text-zinc-500 uppercase tracking-wide">Total</p>
              <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalCents / 100)}
              </p>
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Link
            href={`/accounts/${accountId}/estimates`}
            className="px-4 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-md bg-zinc-900 dark:bg-zinc-100 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Creating…' : 'Create Draft'}
          </button>
        </div>
      </form>
    </div>
  );
}
