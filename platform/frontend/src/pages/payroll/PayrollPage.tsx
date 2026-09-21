import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import {
  DollarSign,
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
  Calendar,
  Users,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  BarChart3,
} from 'lucide-react';
import { usePayrollPeriods, useDeletePayrollPeriod } from '@/hooks/usePayroll';
import { PayrollPeriod, PayrollStatus } from '@/types/payroll';
import { Button, IconButton } from '@/components/shared/Button';
import { Input } from '@/components/shared/Input';
import { Select, MultiSelect } from '@/components/shared/Select';
import { Table, Column } from '@/components/shared/Table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Badge } from '@/components/shared/Badge';

const PayrollPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<PayrollStatus[]>([]);
  const [sortBy, setSortBy] = useState<string>('startDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Fetch payroll periods data
  const { data: payrollData, isLoading, error, refetch } = usePayrollPeriods({
    page: 1,
    limit: 50,
  });

  // Delete payroll period mutation
  const { mutate: deletePayrollPeriod } = useDeletePayrollPeriod();

  // Payroll period data
  const periods: PayrollPeriod[] = payrollData?.data || [];

  // Status options
  const statusOptions: { value: PayrollStatus; label: string }[] = [
    { value: 'draft', label: 'Draft' },
    { value: 'open', label: 'Open' },
    { value: 'processing', label: 'Processing' },
    { value: 'processed', label: 'Processed' },
    { value: 'locked', label: 'Locked' },
    { value: 'paid', label: 'Paid' },
    { value: 'reversed', label: 'Reversed' },
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
    if (selectedRows.length === periods.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(periods.map((period) => period.id));
    }
  }, [selectedRows.length, periods]);

  // Handle delete selected
  const handleDeleteSelected = useCallback(() => {
    if (selectedRows.length === 0) return;
    
    if (window.confirm(`Are you sure you want to delete ${selectedRows.length} payroll period(s)?`)) {
      selectedRows.forEach((id) => {
        deletePayrollPeriod(id);
      });
      setSelectedRows([]);
    }
  }, [selectedRows, deletePayrollPeriod]);

  // Handle delete single payroll period
  const handleDeletePayrollPeriod = useCallback((id: string, periodName: string) => {
    if (window.confirm(`Are you sure you want to delete payroll period ${periodName}?`)) {
      deletePayrollPeriod(id);
    }
  }, [deletePayrollPeriod]);

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

  // Sort periods
  const sortedPeriods = [...periods].sort((a, b) => {
    const aValue = (a as Record<string, unknown>)[sortBy];
    const bValue = (b as Record<string, unknown>)[sortBy];

    if (aValue === undefined || bValue === undefined) return 0;

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortOrder === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    }

    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
    }

    // Handle date sorting
    if (aValue instanceof Date && bValue instanceof Date) {
      return sortOrder === 'asc' ? aValue.getTime() - bValue.getTime() : bValue.getTime() - aValue.getTime();
    }

    return 0;
  });

  // Table columns
  const columns: Column<PayrollPeriod>[] = [
    {
      key: 'periodName',
      header: 'Period',
      sortable: true,
    },
    {
      key: 'startDate',
      header: 'Start Date',
      sortable: true,
      width: '120px',
      render: (value) => (
        <span className="text-sm text-gray-600">
          {new Date(value).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'endDate',
      header: 'End Date',
      sortable: true,
      width: '120px',
      render: (value) => (
        <span className="text-sm text-gray-600">
          {new Date(value).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'year',
      header: 'Year',
      sortable: true,
      width: '80px',
    },
    {
      key: 'week',
      header: 'Week',
      sortable: true,
      width: '80px',
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      width: '120px',
      render: (value) => (
        <Badge
          variant={{
            draft: 'secondary',
            open: 'info',
            processing: 'primary',
            processed: 'success',
            locked: 'warning',
            paid: 'success',
            reversed: 'danger',
          }[value as PayrollStatus] || 'secondary'}
        >
          {value}
        </Badge>
      ),
    },
    {
      key: 'isLocked',
      header: 'Locked',
      sortable: true,
      width: '80px',
      render: (value) => (
        <Badge variant={value ? 'danger' : 'success'}>
          {value ? 'Yes' : 'No'}
        </Badge>
      ),
    },
    {
      key: 'processedAt',
      header: 'Processed',
      sortable: true,
      width: '120px',
      render: (value) => (
        <span className="text-sm text-gray-600">
          {value ? new Date(value).toLocaleDateString() : 'N/A'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '120px',
      render: (_, row) => (
        <div className="flex items-center space-x-1">
          <IconButton
            icon={<Eye size={16} />}
            ariaLabel="View period"
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/payroll/${row.id}`)}
          />
          <IconButton
            icon={<Edit size={16} />}
            ariaLabel="Edit period"
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/payroll/${row.id}/edit`)}
          />
          <IconButton
            icon={<FileText size={16} />}
            ariaLabel="View records"
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/payroll/${row.id}/records`)}
          />
          <IconButton
            icon={<Trash2 size={16} />}
            ariaLabel="Delete period"
            variant="ghost"
            size="sm"
            className="text-danger-600 hover:text-danger-700"
            onClick={() => handleDeletePayrollPeriod(row.id, row.periodName)}
          />
        </div>
      ),
    },
  ];

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner size="lg" text="Loading payroll periods..." />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <p className="text-danger-600 mb-4">Failed to load payroll periods</p>
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
          <h1 className="text-2xl font-bold text-gray-900">Payroll</h1>
          <p className="text-gray-500 mt-1">Manage payroll periods and records</p>
        </div>
        <Button
          leftIcon={<Plus size={16} />}
          onClick={() => navigate('/payroll/new')}
        >
          Create Period
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
                placeholder="Search periods..."
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
                  Year
                </label>
                <Select
                  options={Array.from(new Set(periods.map((p) => ({ value: p.year.toString(), label: p.year.toString() }))))}
                  value={''}
                  onChange={() => {}}
                  placeholder="All years"
                />
              </div>
            </div>
            <div className="flex items-center justify-end mt-4 space-x-2">
              <Button variant="outline" size="sm" onClick={() => {
                setStatusFilter([]);
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

      {/* Payroll periods table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
        <Table
          columns={columns}
          data={sortedPeriods}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          onRowClick={(period) => navigate(`/payroll/${period.id}`)}
          selectedRows={selectedRows}
          onSelectRow={handleSelectRow}
          onSelectAll={handleSelectAll}
          emptyMessage="No payroll periods found"
          searchable
          onSearch={setSearchQuery}
          searchPlaceholder="Search periods..."
          pagination={{
            currentPage: 1,
            totalPages: Math.ceil(periods.length / 10),
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
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Payroll Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">{periods.length}</p>
            <p className="text-sm text-gray-500">Total Periods</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-primary-600">
              {periods.filter((p) => p.status === 'draft' || p.status === 'open').length}
            </p>
            <p className="text-sm text-gray-500">Open</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-warning-600">
              {periods.filter((p) => p.status === 'processing').length}
            </p>
            <p className="text-sm text-gray-500">Processing</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-success-600">
              {periods.filter((p) => p.status === 'processed' || p.status === 'paid').length}
            </p>
            <p className="text-sm text-gray-500">Completed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-danger-600">
              {periods.filter((p) => p.status === 'reversed').length}
            </p>
            <p className="text-sm text-gray-500">Reversed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">
              {periods.filter((p) => p.isLocked).length}
            </p>
            <p className="text-sm text-gray-500">Locked</p>
          </div>
        </div>
      </motion.div>

      {/* Quick stats */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        <div className="card">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
              <Calendar size={20} className="text-primary-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Current Period</p>
              <p className="text-xl font-bold text-gray-900">
                {periods.length > 0 ? periods[0].periodName : 'N/A'}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-success-100 rounded-lg flex items-center justify-center">
              <Users size={20} className="text-success-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Drivers Paid</p>
              <p className="text-xl font-bold text-gray-900">42</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-warning-100 rounded-lg flex items-center justify-center">
              <Clock size={20} className="text-warning-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Next Payday</p>
              <p className="text-xl font-bold text-gray-900">
                {periods.length > 0 ? new Date(periods[0].endDate).toLocaleDateString() : 'N/A'}
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default PayrollPage;
