// Devuelve una versión enmascarada de un email para mostrar al admin
// durante el 2FA — sin exponer el address completo por si mira alguien
// por encima del hombro.
//   "yoyoprola@gmail.com"  → "y***@g***.com"
//   "j@x.io"               → "j***@x***.io"

export function maskEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') return '***@***';
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes('@')) return '***@***';
  const atIdx = trimmed.lastIndexOf('@');
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  if (!local || !domain) return '***@***';
  const dotIdx = domain.lastIndexOf('.');
  const tld = dotIdx >= 0 ? domain.slice(dotIdx) : '';
  const domainName = dotIdx >= 0 ? domain.slice(0, dotIdx) : domain;
  if (!domainName) return '***@***';
  const localFirst = local.charAt(0) || '*';
  const domainFirst = domainName.charAt(0) || '*';
  return `${localFirst}***@${domainFirst}***${tld}`;
}
