import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import { FileCard } from '../../components/files/FileParts';
import { EmptyState, PagedList, PageHeader } from '../../components/workspace/PageParts';
import { useWorkspace } from '../../context/WorkspaceContext';
import { usePagedList } from '../../hooks/usePagedList';
import { FILE_PAGE_SIZE, listSharedFiles } from '../../services/fileService';

const SEARCH_DELAY_MS = 300;

/** Every file shared in places the employee can access, and nothing else. */
export default function SharedDocumentsPage() {
  const { subscribeToMessages } = useWorkspace();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const resetKey = useMemo(() => JSON.stringify([search, kind]), [search, kind]);
  const fetchPage = useCallback((page) => listSharedFiles({ search, kind, ...page }), [search, kind]);
  const list = usePagedList(fetchPage, resetKey, FILE_PAGE_SIZE);
  const { refresh } = list;

  useEffect(
    () =>
      subscribeToMessages(({ row }) => {
        if (row.message_type === 'file') refresh();
      }),
    [subscribeToMessages, refresh],
  );

  const isFiltered = Boolean(search || kind);

  return (
    <div className="page">
      <PageHeader title="Shared Documents" subtitle="Files from your conversations, groups and channels." />

      <div className="filters filters--two">
        <label className="filter-input">
          <span className="sr-only">Search files by name</span>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by file name"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Filter by type</span>
          <select className="select" value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">All files</option>
            <option value="document">Documents</option>
            <option value="image">Images</option>
          </select>
        </label>
      </div>

      <div className="document-page">
        <PagedList
          list={list}
          emptyState={
            <EmptyState icon={FileText} title={isFiltered ? 'No matching files' : 'No files yet'}>
              {isFiltered
                ? 'Try a different search or clear the filter.'
                : 'Files shared in your conversations, groups and channels will appear here.'}
            </EmptyState>
          }
        >
          {list.items.map((file) => (
            <li key={file.id} className="document-row">
              <FileCard file={file} showImage={false} showLocation onDeleted={() => list.removeItem(file.id)} />
            </li>
          ))}
        </PagedList>
      </div>
    </div>
  );
}
