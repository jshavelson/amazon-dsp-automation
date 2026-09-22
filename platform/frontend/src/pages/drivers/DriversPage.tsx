import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Filter,
  MoreVertical,
  Edit,
  Trash2,
  Eye,
  Users,
} from 'lucide-react';
import { useDrivers, useDeleteDriver } from '@/hooks/useDrivers';
import { Driver, DriverStatus, EmploymentType } from '@/types/driver';
import { Button, IconButton } from '@/components/shared/Button';
import { Input } from '@/components/shared/Input';
import { MultiSelect } from '@/components/shared/Select';
import { Table, Column } from '@/components/shared/Table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Badge } from '@/components/shared/Badge';

const driverStatusVariants: Record<DriverStatus, 'success' | 'warning' | 'danger' | 'info' | 'secondary'> = {
  active: 'success',
  on_leave: 'warning',
  terminated: 'danger',
  suspended: 'danger',
  pending_onboarding: 'info',
  inactive: 'secondary',
};

const DriversPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DriverStatus[]>([]);
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState<EmploymentType[]>([]);
  const [sortBy, setSortBy] = useState<string>('lastName');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Load the roster once. Search, filtering, sorting, and pagination are local
  // so typing never tears down the screen or creates a request per keystroke.
  const { data: driversData, isLoading, error, refetch } = useDrivers({
    page: 1,
    limit: 500,
  });

  // Delete driver mutation
  const { mutate: deleteDriver } = useDeleteDriver();

  // The local operational API returns a compact driver roster while the
  // production API returns a paginated Driver payload. Normalize both shapes
  // here so local navigation displays the real roster instead of an empty table.
  const driverPayload = driversData as unknown as { data?: Array<Partial<Driver> & { name?: string; status?: string }>; needsData?: boolean; message?: string } | Array<Partial<Driver> & { name?: string; status?: string }> | undefined;
  const driverRows = (Array.isArray(driverPayload) ? driverPayload : driverPayload?.data || []);
  const needsData = !Array.isArray(driverPayload) && driverPayload?.needsData;
  const drivers: Driver[] = driverRows.map((row, index) => {
    if (row.firstName || row.lastName) return row as Driver;
    const parts = (row.name || 'Unknown Driver').trim().split(/\s+/);
    const firstName = parts.shift() || 'Unknown';
    const lastName = parts.join(' ');
    const standing = String(row.status || 'Active');
    return {
      ...row,
      id: row.id || `driver-${index}`,
      employeeId: row.id || `DA-${index + 1}`,
      firstName,
      lastName,
      email: '',
      phone: '',
      status: 'active',
      employmentType: 'full_time',
      performanceRating: standing === 'Platinum' ? 100 : standing === 'Gold' ? 90 : 85,
    } as Driver;
  });

  // Status options
  const statusOptions: { value: DriverStatus; label: string }[] = [
    { value: 'active', label: 'Active' },
    { value: 'on_leave', label: 'On Leave' },
    { value: 'terminated', label: 'Terminated' },
    { value: 'suspended', label: 'Suspended' },
    { value: 'pending_onboarding', label: 'Pending Onboarding' },
    { value: 'inactive', label: 'Inactive' },
  ];

  // Employment type options
  const employmentTypeOptions: { value: EmploymentType; label: string }[] = [
    { value: 'full_time', label: 'Full Time' },
    { value: 'part_time', label: 'Part Time' },
    { value: 'contract', label: 'Contract' },
    { value: 'temporary', label: 'Temporary' },
  ];

  // Handle sort
  const handleSort = useCallback((key: string) => {
    let newSortOrder: 'asc' | 'desc' = 'asc';
    if (sortBy === key) {
      newSortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    }
    setSortBy(key);
    setSortOrder(newSortOrder);
  }, [sortBy, sortOrder]);

  // Handle row selection
  const handleSelectRow = useCallback((id: string) => {
    setSelectedRows((prev) =>
      prev.includes(id) ? prev.filter((rowId) => rowId !== id) : [...prev, id]
    );
  }, []);

  // Handle delete selected
  const handleDeleteSelected = useCallback(() => {
    if (selectedRows.length === 0) return;
    
    if (window.confirm(`Are you sure you want to delete ${selectedRows.length} driver(s)?`)) {
      selectedRows.forEach((id) => {
        deleteDriver(id);
      });
      setSelectedRows([]);
    }
  }, [selectedRows, deleteDriver]);

  // Handle delete single driver
  const handleDeleteDriver = useCallback((id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete ${name}?`)) {
      deleteDriver(id);
    }
  }, [deleteDriver]);

  const filteredDrivers = drivers.filter((driver) => {
    const needle = searchQuery.trim().toLowerCase();
    const matchesSearch = !needle || [
      driver.employeeId,
      driver.firstName,
      driver.lastName,
      `${driver.firstName} ${driver.lastName}`,
      driver.email,
      driver.phone,
      driver.status,
    ].some((value) => String(value || '').toLowerCase().includes(needle));
    return matchesSearch
      && (statusFilter.length === 0 || statusFilter.includes(driver.status))
      && (employmentTypeFilter.length === 0 || employmentTypeFilter.includes(driver.employmentType));
  });

  // Sort drivers
  const sortedDrivers = [...filteredDrivers].sort((a, b) => {
    const aValue = (a as unknown as Record<string, unknown>)[sortBy];
    const bValue = (b as unknown as Record<string, unknown>)[sortBy];

    if (aValue === undefined || bValue === undefined) return 0;

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortOrder === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    }

    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
    }

    return 0;
  });
  const totalPages = Math.max(1, Math.ceil(sortedDrivers.length / pageSize));
  const visibleDrivers = sortedDrivers.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Select only the currently visible page; preserve selections made elsewhere.
  const handleSelectAll = useCallback(() => {
    const visibleIds = visibleDrivers.map((driver) => driver.id);
    const allVisibleSelected = visibleIds.every((id) => selectedRows.includes(id));
    setSelectedRows((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])]);
  }, [selectedRows, visibleDrivers]);

  // Table columns
  const columns: Column<Driver>[] = [
    {
      key: 'employeeId',
      header: 'Employee ID',
      sortable: true,
      width: '120px',
    },
    {
      key: 'firstName',
      header: 'First Name',
      sortable: true,
    },
    {
      key: 'lastName',
      header: 'Last Name',
      sortable: true,
    },
    {
      key: 'email',
      header: 'Email',
      sortable: true,
    },
    {
      key: 'phone',
      header: 'Phone',
      sortable: true,
      width: '120px',
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      width: '120px',
      render: (value) => (
        <Badge
          variant={driverStatusVariants[value as DriverStatus] || 'secondary'}
        >
          {String(value)}
        </Badge>
      ),
    },
    {
      key: 'employmentType',
      header: 'Type',
      sortable: true,
      width: '120px',
      render: (value) => (
        <Badge variant="secondary">
          {String(value)}
        </Badge>
      ),
    },
    {
      key: 'performanceRating',
      header: 'Rating',
      sortable: true,
      width: '80px',
      render: (value) => (
        <span className="font-medium text-gray-900">
          {Number(value).toFixed(1)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '80px',
      render: (_, row) => (
        <div className="flex items-center space-x-1">
          <IconButton
            icon={<Eye size={16} />}
            ariaLabel="View driver"
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/drivers/${row.id}`)}
          />
          <IconButton
            icon={<Edit size={16} />}
            ariaLabel="Edit driver"
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/drivers/${row.id}/edit`)}
          />
          <IconButton
            icon={<Trash2 size={16} />}
            ariaLabel="Delete driver"
            variant="ghost"
            size="sm"
            className="text-danger-600 hover:text-danger-700"
            onClick={() => handleDeleteDriver(row.id, `${row.firstName} ${row.lastName}`)}
          />
        </div>
      ),
    },
  ];

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner size="lg" text="Loading drivers..." />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <p className="text-danger-600 mb-4">Failed to load drivers</p>
          <Button onClick={() => refetch()}>Retry</Button>
        </div>
      </div>
    );
  }

  if (needsData) {
    return (
      <div className="space-y-6">
        <header><h1 className="text-2xl font-bold text-gray-900 dark:text-white">Drivers</h1><p className="mt-1 text-gray-500 dark:text-slate-400">Manage your driver team.</p></header>
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <Users className="mx-auto mb-3" size={28}/><strong>No driver roster for this tenant.</strong><p className="mt-2 text-sm">{driverPayload?.message}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Drivers</h1>
          <p className="text-gray-500 mt-1">Manage your driver team</p>
        </div>
        <Button
          leftIcon={<Plus size={16} />}
          onClick={() => navigate('/drivers/new')}
        >
          Add Driver
        </Button>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <Input
                type="text"
                placeholder="Search drivers..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-10 w-64"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
            >
              <Filter size={16} />
            </button>
          </div>
          <div className="flex items-center space-x-2">
            {selectedRows.length > 0 && (
              <>
                <span className="text-sm text-gray-500">
                  {selectedRows.length} selected
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  leftIcon={<Trash2 size={14} />}
                  onClick={handleDeleteSelected}
                >
                  Delete Selected
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              leftIcon={<MoreVertical size={14} />}
            >
              More Actions
            </Button>
          </div>
        </div>

        {/* Filter dropdown */}
        {showFilters && (
          <div className="overflow-hidden border-t border-gray-200 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Status
                </label>
                <MultiSelect
                  options={statusOptions}
                  value={statusFilter}
                  onChange={(value) => {
                    setStatusFilter(value as DriverStatus[]);
                    setCurrentPage(1);
                  }}
                  placeholder="All statuses"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Employment Type
                </label>
                <MultiSelect
                  options={employmentTypeOptions}
                  value={employmentTypeFilter}
                  onChange={(value) => {
                    setEmploymentTypeFilter(value as EmploymentType[]);
                    setCurrentPage(1);
                  }}
                  placeholder="All types"
                />
              </div>
            </div>
            <div className="flex items-center justify-end mt-4 space-x-2">
              <Button variant="outline" size="sm" onClick={() => {
                setStatusFilter([]);
                setEmploymentTypeFilter([]);
                setCurrentPage(1);
              }}>
                Clear
              </Button>
              <Button size="sm" onClick={() => setShowFilters(false)}>
                Apply
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Drivers table */}
      <div className="card">
        <Table
          columns={columns}
          data={visibleDrivers}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          onRowClick={(driver) => navigate(`/drivers/${driver.id}`)}
          selectedRows={selectedRows}
          onSelectRow={handleSelectRow}
          onSelectAll={handleSelectAll}
          emptyMessage="No drivers found"
          pagination={{
            currentPage,
            totalPages,
            onPageChange: setCurrentPage,
            onPageSizeChange: (size) => {
              setPageSize(size);
              setCurrentPage(1);
            },
            pageSize,
            totalItems: sortedDrivers.length,
            pageSizeOptions: [10, 25, 50, 100],
          }}
        />
      </div>

      {/* Summary */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">{drivers.length}</p>
            <p className="text-sm text-gray-500">Total Drivers</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-success-600">
              {drivers.filter((d) => d.status === 'active').length}
            </p>
            <p className="text-sm text-gray-500">Active</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-warning-600">
              {drivers.filter((d) => d.status === 'on_leave').length}
            </p>
            <p className="text-sm text-gray-500">On Leave</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-danger-600">
              {drivers.filter((d) => d.status === 'terminated' || d.status === 'suspended').length}
            </p>
            <p className="text-sm text-gray-500">Inactive</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DriversPage;
