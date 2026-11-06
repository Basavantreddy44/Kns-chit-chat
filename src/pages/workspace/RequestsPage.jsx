import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import Alert from '../../components/common/Alert';
import { ConnectionActions, EmployeeRow } from '../../components/workspace/EmployeeParts';
import { EmptyState, PagedList, PageHeader } from '../../components/workspace/PageParts';
import { useWorkspace } from '../../context/WorkspaceContext';
import { usePagedList } from '../../hooks/usePagedList';
import { listConnectionRequests, PAGE_SIZE } from '../../services/employeeService';
import { formatDateTime } from '../../utils/format';

const TABS = [
  { box: 'incoming', label: 'Incoming', empty: 'No incoming requests' },
  { box: 'sent', label: 'Sent', empty: 'No sent requests' },
  { box: 'accepted', label: 'Accepted', empty: 'No accepted requests' },
  { box: 'rejected', label: 'Rejected', empty: 'No rejected requests' },
];

const toActionState = { incoming: 'request_received', sent: 'request_sent' };

export default function RequestsPage() {
  const [box, setBox] = useState(TABS[0].box);
  const [actionError, setActionError] = useState('');
  const { lastEventAt } = useWorkspace();

  const fetchPage = useCallback((page) => listConnectionRequests({ box, ...page }), [box]);
  const list = usePagedList(fetchPage, box, PAGE_SIZE);
  const { reload, refresh } = list;

  // A new request arriving while this page is open shows up straight away.
  useEffect(() => {
    if (lastEventAt) refresh();
  }, [lastEventAt, refresh]);

  const activeTab = TABS.find((tab) => tab.box === box);

  return (
    <div className="page">
      <PageHeader title="Connection Requests" subtitle="Requests you have received and sent." />

      <div className="tabs" role="tablist" aria-label="Request type">
        {TABS.map((tab) => (
          <button
            key={tab.box}
            type="button"
            role="tab"
            className="tabs__tab"
            aria-selected={tab.box === box}
            onClick={() => {
              setActionError('');
              setBox(tab.box);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="page__stack" style={{ marginBottom: 'var(--space-4)' }}>
          <Alert variant="error" onDismiss={() => setActionError('')}>
            {actionError}
          </Alert>
        </div>
      )}

      <PagedList
        list={list}
        emptyState={
          <EmptyState icon={UserPlus} title={activeTab.empty}>
            {box === 'incoming' || box === 'sent' ? (
              <>
                Find colleagues in the <Link to="/directory">Employee Directory</Link>.
              </>
            ) : null}
          </EmptyState>
        }
      >
        {list.items.map((request) => (
          <EmployeeRow key={request.request_id} employee={request}>
            <span className="row__meta">{formatDateTime(request.updated_at)}</span>
            {toActionState[box] ? (
              <ConnectionActions
                employee={{ ...request, connection_status: toActionState[box] }}
                onChanged={reload}
                onError={setActionError}
              />
            ) : box === 'accepted' ? (
              <span className="status-tag status-tag--success">Accepted</span>
            ) : (
              <span className="status-tag status-tag--error">
                {request.direction === 'sent' ? 'Declined' : 'You rejected'}
              </span>
            )}
          </EmployeeRow>
        ))}
      </PagedList>
    </div>
  );
}
