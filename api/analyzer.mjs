import { handleRequest } from '../server.mjs';

export default function analyzer(request, response) {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api/analyzer') {
    const routedPath = url.searchParams.get('__analyzerPath');
    if (routedPath?.startsWith('/api/') || routedPath?.startsWith('/assets/')) {
      url.pathname = routedPath;
    }
  }
  url.searchParams.delete('__analyzerPath');
  return handleRequest(request, response, url);
}
