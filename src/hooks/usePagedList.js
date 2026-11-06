import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads a list one page at a time.
 *
 *   const list = usePagedList(fetchPage, resetKey, 24);
 *
 * fetchPage({ limit, offset }) returns an array. Changing `resetKey` (for
 * example a search term) starts again from the first page, and a slow response
 * to an older request can never overwrite a newer one.
 */
export function usePagedList(fetchPage, resetKey, pageSize) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | loadingMore | error
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const latestRequest = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const itemCount = useRef(0);
  itemCount.current = items.length;

  const load = useCallback(
    async (offset, previous) => {
      const requestId = ++latestRequest.current;
      setStatus(offset === 0 ? 'loading' : 'loadingMore');
      setError('');
      try {
        const page = (await fetchRef.current({ limit: pageSize, offset })) ?? [];
        if (requestId !== latestRequest.current) return;
        setItems([...previous, ...page]);
        setHasMore(page.length === pageSize);
        setStatus('ready');
      } catch (loadError) {
        if (requestId !== latestRequest.current) return;
        setError(loadError?.message || 'Something went wrong. Please try again.');
        setStatus('error');
      }
    },
    [pageSize],
  );

  useEffect(() => {
    load(0, []);
  }, [load, resetKey]);

  const reload = useCallback(() => load(0, []), [load]);

  // Fetches what's on screen again without a loading state, for live updates.
  const refresh = useCallback(async () => {
    const requestId = ++latestRequest.current;
    try {
      const limit = Math.min(Math.max(itemCount.current, pageSize), 100);
      const page = (await fetchRef.current({ limit, offset: 0 })) ?? [];
      if (requestId !== latestRequest.current) return;
      setItems(page);
      setHasMore(page.length === limit);
      setStatus('ready');
    } catch {
      // Keep showing what we have: the next update will try again.
    }
  }, [pageSize]);

  const loadMore = useCallback(() => {
    setItems((current) => {
      load(current.length, current);
      return current;
    });
  }, [load]);
  const replaceItem = useCallback((id, next) => {
    setItems((current) => current.map((item) => (item.id === id ? next : item)));
  }, []);
  const removeItem = useCallback((id) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  return { items, status, error, hasMore, reload, refresh, loadMore, replaceItem, removeItem };
}
