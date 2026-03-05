export function defaultMlModelBaseUrl(): string {
  try {
    // Build from the current module URL without relative URL string literals, so
    // bundlers don't try to resolve a non-existent src/models directory at build time.
    const moduleUrl = new URL(import.meta.url);
    const dir = moduleUrl.pathname.slice(0, moduleUrl.pathname.lastIndexOf('/') + 1);
    moduleUrl.pathname = `${dir}models/`;
    moduleUrl.search = '';
    moduleUrl.hash = '';
    return moduleUrl.toString();
  } catch {
    if (typeof window !== 'undefined' && window.location) {
      return new URL('/models/', window.location.origin).toString();
    }
    return '/models/';
  }
}
