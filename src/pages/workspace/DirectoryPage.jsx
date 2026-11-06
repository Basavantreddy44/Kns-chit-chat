import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookUser, Search } from 'lucide-react';
import Alert from '../../components/common/Alert';
import { ConnectionActions, EmployeeRow } from '../../components/workspace/EmployeeParts';
import { EmptyState, PagedList, PageHeader } from '../../components/workspace/PageParts';
import { DEPARTMENTS } from '../../config/departments';
import { usePagedList } from '../../hooks/usePagedList';
import { getEmployee, PAGE_SIZE, searchEmployees } from '../../services/employeeService';

const SEARCH_DELAY_MS = 300;

const STATUS_OPTIONS = [
  { value: '', label: 'Any connection status' },
  { value: 'none', label: 'Not connected' },
  { value: 'request_sent', label: 'Request sent' },
  { value: 'request_received', label: 'Request received' },
  { value: 'connected', label: 'Connected' },
];

export default function DirectoryPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const resetKey = useMemo(() => JSON.stringify([search, department, status]), [search, department, status]);
  const fetchPage = useCallback(
    (page) => searchEmployees({ search, department, status, ...page }),
    [search, department, status],
  );
  const list = usePagedList(fetchPage, resetKey, PAGE_SIZE);
  const { replaceItem, removeItem } = list;

  const refreshEmployee = useCallback(
    async (id) => {
      const employee = await getEmployee(id).catch(() => null);
      if (employee) replaceItem(id, employee);
      else removeItem(id);
    },
    [replaceItem, removeItem],
  );

  const isFiltered = Boolean(search || department || status);

  return (
    <div className="page">
      <PageHeader title="Employee Directory" subtitle="Find colleagues across KNS and connect with them." />

      <div className="filters">
        <label className="filter-input">
          <span className="sr-only">Search by name, username or department</span>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by name, username or department"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Filter by department</span>
          <select className="select" value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="">All departments</option>
            {DEPARTMENTS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by connection status</span>
          <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUS_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
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
          <EmptyState icon={BookUser} title={isFiltered ? 'No matching employees' : 'No other employees yet'}>
            {isFiltered
              ? 'Try a different search or clear the filters.'
              : 'Colleagues will appear here once they register.'}
          </EmptyState>
        }
      >
        {list.items.map((employee) => (
          <EmployeeRow key={employee.id} employee={employee}>
            <ConnectionActions
              employee={employee}
              onChanged={() => refreshEmployee(employee.id)}
              onError={setActionError}
            />
          </EmployeeRow>
        ))}
      </PagedList>
    </div>
  );
}
