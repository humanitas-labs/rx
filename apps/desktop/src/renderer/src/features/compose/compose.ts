// Pure compose helpers (plan step 10).

import type { DeliveryFailureView } from '@rx/contract';

export const FAILURE_TEXT: Record<DeliveryFailureView, string> = {
  'permission-denied':
    'Messages automation was denied — grant rx access under System Settings → Privacy → Automation.',
  'messages-unavailable': 'Messages.app is unavailable.',
  'automation-error': 'Send failed in Messages automation.',
  'not-verified': 'Send not confirmed — nothing arrived in the conversation.',
};

/** Phone (7–15 digits, optional +, common separators) or email. */
export function validHandle(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return trimmed;
  }
  const digits = trimmed.replace(/[\s\-().]/g, '');
  if (/^\+?\d{7,15}$/.test(digits)) {
    return digits;
  }
  return null;
}
