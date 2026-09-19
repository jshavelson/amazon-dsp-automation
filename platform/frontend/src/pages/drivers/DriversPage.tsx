import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import {
  Users,
  Plus,
  Search,
  Filter,
  MoreVertical,
  Edit,
  Trash2,
  Eye,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react';
import { useDrivers, useDeleteDriver } from '@/hooks/useDrivers';
import { Driver, DriverStatus, EmploymentType } from '@/types/driver';
import { Button, IconButton } from '@/components/shared/Button';
import { Input } from '@/components/shared/Input';
import { Select, MultiSelect } from '@/components/shared/Select';
import { Table, Column } from '@/components/shared/Table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Badge } from '@/components/shared/Badge';

const DriversPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DriverStatus[]>([]);
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState<EmploymentType[]>([]);
  const [sortBy, setSortBy] = useState<string>('lastName');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Fetch drivers data
  const { data: driversData, isLoading, error, refetch } = useDrivers({
    search: searchQuery,
    status: statusFilter.length > 0 ? statusFilter[0] : undefined,
    employmentType: employmentTypeFilter.length > 0 ? employmentTypeFilter[0] : undefined,
    page: 1,
    limit: 50,
  });

  // Delete driver mutation
  const { mutate: deleteDriver } = useDeleteDriver();

  // Driver data
  const drivers: Driver[] = driversData?.data || [];

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

  // Handle select all
  const handleSelectAll = useCallback(() => {
    if (selectedRows.length === drivers.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(drivers.map((driver) => driver.id));
    }
  }, [selectedRows.length, drivers]);

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

  // Get sort icon
  const getSortIcon = useCallback((key: string) => {
    if (sortBy !== key) {
      return <ChevronsUpDown size={14} className="text-gray-400" />;
    }
    return sortOrder === 'asc' ? (
      <ChevronUp size={14} className="text-primary-600" />
    ) : (
      <ChevronDown size={14} className="text-primary-600" />
    );
  }, [sortBy, sortOrder]);

  // Sort drivers
  const sortedDrivers = [...drivers].sort((a, b) => {
    const aValue = (a as Record<string, unknown>)[sortBy];
    const bValue = (b as Record<string, unknown>)[sortBy];

    if (aValue === undefined || bValue === undefined) return 0;

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortOrder === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    }

    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
    }

    return 0;
  });

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
          variant={
            active: 'success',
            on_leave: 'warning',
            terminated: 'danger',
            suspended: 'danger',
            pending_onboarding: 'info',
            inactive: 'secondary',
          }[value as DriverStatus] || 'secondary'}
        >
          {value}
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
          {value}
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
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading drivers..." />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-danger-600 mb-4">Failed to load drivers</p>
          <Button onClick={() => refetch()}>Retry</Button>
        </div>
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
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
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
                onChange={(e) => setSearchQuery(e.target.value)}
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
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-gray-200 pt-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Status
                </label>
                <MultiSelect
                  options={statusOptions}
                  value={statusFilter}
                  onChange={setStatusFilter}
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
                  onChange={setEmploymentTypeFilter}
                  placeholder="All types"
                />
              </div>
            </div>
            <div className="flex items-center justify-end mt-4 space-x-2">
              <Button variant="outline" size="sm" onClick={() => {
                setStatusFilter([]);
                setEmploymentTypeFilter([]);
              }}>
                Clear
              </Button>
              <Button size="sm" onClick={() => setShowFilters(false)}>
                Apply
              </Button>
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Drivers table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
        <Table
          columns={columns}
          data={sortedDrivers}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          onRowClick={(driver) => navigate(`/drivers/${driver.id}`)}
          selectedRows={selectedRows}
          onSelectRow={handleSelectRow}
          onSelectAll={handleSelectAll}
          emptyMessage="No drivers found"
          searchable
          onSearch={setSearchQuery}
          searchPlaceholder="Search drivers..."
          pagination={{
            currentPage: 1,
            totalPages: Math.ceil(drivers.length / 10),
            onPageChange: (page) => {},
            pageSize: 10,
            pageSizeOptions: [10, 25, 50, 100],
          }}
        />
      </motion.div>

      {/* Summary */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
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
      </motion.div>
    </div>
  );
};

export default DriversPage;
