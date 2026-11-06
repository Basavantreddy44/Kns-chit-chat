import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import Alert from '../../components/common/Alert';
import Button from '../../components/common/Button';
import { EmployeeRow, StartChatButton } from '../../components/workspace/EmployeeParts';
import { ConfirmDialog, EmptyState, PagedList, PageHeader } from '../../components/workspace/PageParts';
import { usePagedList } from '../../hooks/usePagedList';
import { listConnections, PAGE_SIZE, removeConnection } from '../../services/employeeService';

export default function ConnectionsPage() {
  const fetchPage = useCallback((page) => listConnections(page), []);
  const list = usePagedList(fetchPage, 'connections', PAGE_SIZE);
  const [toRemove, setToRemove] = useState(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [actionError, setActionError] = useState('');

  const confirmRemove = async () => {
    setIsRemoving(true);
    setActionError('');
    try {
      await removeConnection(toRemove.id);
      list.removeItem(toRemove.id);
    } catch (error) {
      setActionError(error?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsRemoving(false);
      setToRemove(null);
    }
  };

  return (
    <div className="page">
      <PageHeader title="My Connections" subtitle="Colleagues you are connected with." />

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
          <EmptyState icon={Users} title="No connections yet">
            Find colleagues in the <Link to="/directory">Employee Directory</Link> and send a connection request.
          </EmptyState>
        }
      >
        {list.items.map((employee) => (
          <EmployeeRow key={employee.id} employee={employee}>
            <StartChatButton employee={employee} label="Message" onError={setActionError} />
            <Link to={`/employees/${employee.id}`} className="row__link">
              View profile
            </Link>
            <Button
              variant="ghost"
              onClick={() => setToRemove(employee)}
              aria-label={`Remove connection with ${employee.full_name}`}
            >
              Remove
            </Button>
          </EmployeeRow>
        ))}
      </PagedList>

      {toRemove && (
        <ConfirmDialog
          title="Remove connection?"
          confirmLabel="Remove connection"
          isBusy={isRemoving}
          onConfirm={confirmRemove}
          onCancel={() => setToRemove(null)}
        >
          You and {toRemove.full_name} will no longer be connected. Either of you can send a new request later.
        </ConfirmDialog>
      )}
    </div>
  );
}
