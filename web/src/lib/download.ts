export function downloadText(text: string, name: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.hidden = true;
  document.body.append(a);
  try { a.click(); } finally { a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
export function downloadJson(value: unknown, name: string) { downloadText(JSON.stringify(value, null, 2), name, 'application/json'); }
