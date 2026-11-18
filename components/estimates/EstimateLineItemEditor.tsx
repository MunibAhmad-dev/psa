'use client';

import { Trash2 } from 'lucide-react';

export interface LineItemDraft {
  id: string;
  description: string;
  quantity: number;
  unit_price_cents: number; // always minor units (cents)
}

interface Props {
  item: LineItemDraft;
  index: number;
  onChange: (patch: Partial<LineItemDraft>) => void;
  onRemove?: () => void;
}

/** Convert a dollar string the user typed to integer cents. */
function dollarsToCents(value: string): number {
  const parsed = parseFloat(value.replace(/[^0-9.]/g, ''));
  if (isNaN(parsed)) return 0;
  return Math.round(parsed * 100);
}

/** Format cents as a dollar string for the input display. */
function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function EstimateLineItemEditor({ item, index, onChange, onRemove }: Props) {
  const lineTotal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format((item.unit_price_cents * item.quantity) / 100);

  return (
    <div className="px-5 py-4 space-y-3">
      <div className="flex items-start gap-3">
        {/* Row number */}
        <span className="mt-2.5 text-xs text-zinc-400 w-5 shrink-0 text-right">{index + 1}</span>

        <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-start">
          {/* Description */}
          <input
            value={item.description}
            onChange={e => onChange({ description: e.target.value })}
            placeholder="Description"
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500"
          />

          {/* Quantity */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-400">Qty</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={item.quantity}
              onChange={e => {
                const q = parseFloat(e.target.value);
                if (!isNaN(q) && q > 0) onChange({ quantity: q });
              }}
              className="w-20 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-500 text-right"
            />
          </div>

          {/* Unit price */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-400">Unit Price</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={centsToDisplay(item.unit_price_cents)}
                onChange={e => onChange({ unit_price_cents: dollarsToCents(e.target.value) })}
                className="w-28 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-6 pr-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-500 text-right"
              />
            </div>
          </div>

          {/* Line total (read-only) */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-400">Total</label>
            <div className="w-28 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 text-right tabular-nums">
              {lineTotal}
            </div>
          </div>
        </div>

        {/* Remove button */}
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="mt-7 p-1.5 rounded-md text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            aria-label="Remove line item"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : (
          <div className="mt-7 w-7" />
        )}
      </div>
    </div>
  );
}
