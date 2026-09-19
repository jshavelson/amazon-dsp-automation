import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import {
  FileText,
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
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  BarChart3,
} from 'lucide-react';
import { useDisputes, useDeleteDispute } from '@/hooks/useDisputes';
import { Dispute, DisputeType, DisputeStatus, DisputePriority } from '@/types/dispute';
import { Button, IconButton } from '@/components/shared/Button';
import { Input } from '@/components/shared/Input';
import { Select, MultiSelect } from '@/components/shared/Select';
import { Table, Column } from '@/components/shared/Table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Badge } from '@/components/shared/Badge';

const DisputesPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<DisputeType[]>([]);
  const [statusFilter, setStatusFilter] = useState<DisputeStatus[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<DisputePriority[]>([]);
  const [sortBy, setSortBy] = useState<string>('submissionDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Fetch disputes data
  const { data: disputesData, isLoading, error, refetch } = useDisputes({
    search: searchQuery,
    disputeType: typeFilter.length > 0 ? typeFilter[0] : undefined,
    status: statusFilter.length > 0 ? statusFilter[0] : undefined,
    priority: priorityFilter.length > 0 ? priorityFilter[0] : undefined,
    page: 1,
    limit: 50,
  });

  // Delete dispute mutation
  const { mutate: deleteDispute } = useDeleteDispute();

  // Dispute data
  const disputes: Dispute[] = disputesData?.data || [];

  // Type options
  const typeOptions: { value: DisputeType; label: string }[] = [
    { value: 'dcr', label: 'DCR' },
    { value: 'rts', label: 'RTS' },
    { value: 'quality', label: 'Quality' },
    { value: 'safety', label: 'Safety' },
    { value: 'pod', label: 'POD' },
    { value: 'dsb_dnr', label: 'DSB/DNR' },
    { value: 'psb', label: 'PSB' },
    { value: 'cdf', label: 'CDF' },
    { value: 'dvic', label: 'DVIC' },
    { value: 'capacity', label: 'Capacity' },
    { value: 'payroll', label: 'Payroll' },
    { value: 'other', label: 'Other' },
  ];

  // Status options
  const statusOptions: { value: DisputeStatus; label: string }[] = [
    { value: 'draft', label: 'Draft' },
    { value: 'pending_review', label: 'Pending Review' },
    { value: 'under_review', label: 'Under Review' },
    { value: 'pending_evidence', label: 'Pending Evidence' },
    { value: 'ready_for_submission', label: 'Ready for Submission' },
    { value: 'submitted', label: 'Submitted' },
    { value: 'amazon_review', label: 'Amazon Review' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'appealed', label: 'Appealed' },
    { value: 'closed', label: 'Closed' },
    { value: 'archived', label: 'Archived' },
  ];

  // Priority options
  const priorityOptions: { value: DisputePriority; label: string }[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
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
    if (selectedRows.length === disputes.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(disputes.map((dispute) => dispute.id));
    }
  }, [selectedRows.length, disputes]);

  // Handle delete selected
  const handleDeleteSelected = useCallback(() => {
    if (selectedRows.length === 0) return;
    
    if (window.confirm(`Are you sure you want to delete ${selectedRows.length} dispute(s)?`)) {
      selectedRows.forEach((id) => {
        deleteDispute(id);
      });
      setSelectedRows([]);
    }
  }, [selectedRows, deleteDispute]);

  // Handle delete single dispute
  const handleDeleteDispute = useCallback((id: string, caseNumber: string) => {
    if (window.confirm(`Are you sure you want to delete dispute ${caseNumber}?`)) {
      deleteDispute(id);
    }
  }, [deleteDispute]);

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

  // Sort disputes
  const sortedDisputes = [...disputes].sort((a, b) => {
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
  const columns: Column<Dispute>[] = [
    {
      key: 'caseNumber',
      header: 'Case #',
      sortable: true,
      width: '100px',
    },
    {
      key: 'disputeType',
      header: 'Type',
      sortable: true,
      width: '100px',
      render: (value) => (
        <Badge variant="secondary">
          {value}
        </Badge>
      ),
    },
    {
      key: 'driverName',
      header: 'Driver',
      sortable: true,
    },
    {
      key: 'routeDate',
      header: 'Route Date',
      sortable: true,
      width: '120px',
      render: (value) => (
        <span className="text-sm text-gray-600">
          {new Date(value).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      sortable: true,
      width: '120px',
    },
    {
      key: 'subcategory',
      header: 'Subcategory',
      sortable: true,
      width: '150px',
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      width: '150px',
      render: (value) => (
        <Badge
          variant={
            draft: 'secondary',
            pending_review: 'info',
            under_review: 'primary',
            pending_evidence: 'warning',
            ready_for_submission: 'success',
            submitted: 'primary',
            amazon_review: 'warning',
            approved: 'success',
            rejected: 'danger',
            appealed: 'warning',
            closed: 'secondary',
            archived: 'secondary',
          }[value as DisputeStatus] || 'secondary'}
        >
          {value.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      sortable: true,
      width: '100px',
      render: (value) => (
        <Badge
          variant={
            low: 'secondary',
            medium: 'info',
            high: 'warning',
            urgent: 'danger',
          }[value as DisputePriority] || 'secondary'}
        >
          {value}
        </Badge>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      sortable: true,
      width: '100px',
      render: (value) => (
        <span className="font-medium text-gray-900">
          ${Number(value).toFixed(2)}
        </span>
      ),
    },
    {
      key: 'confidenceScore',
      header: 'Confidence',
      sortable: true,
      width: '100px',
      render: (value) => (
        <span className="font-medium text-gray-900">
          {Number(value).toFixed(0)}%
        </span>
      ),
    },
    {
      key: 'submissionDate',
      header: 'Submitted',
      sortable: true,
      width: '120px',
      render: (value) => (
        <span className="text-sm text-gray-600">
          {new Date(value).toLocaleDateString()}
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
            ariaLabel="View dispute"
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/disputes/${row.id}`)}
          />
          <IconButton
            icon={<Edit size={16} />}
            ariaLabel="Edit dispute"
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/disputes/${row.id}/edit`)}
          />
          <IconButton
            icon={<Trash2 size={16} />}
            ariaLabel="Delete dispute"
            variant="ghost"
            size="sm"
            className="text-danger-600 hover:text-danger-700"
            onClick={() => handleDeleteDispute(row.id, row.caseNumber)}
          />
        </div>
      ),
    },
  ];

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading disputes..." />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-danger-600 mb-4">Failed to load disputes</p>
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
          <h1 className="text-2xl font-bold text-gray-900">Disputes</h1>
          <p className="text-gray-500 mt-1">Manage and track dispute submissions</p>
        </div>
        <Button
          leftIcon={<Plus size={16} />}
          onClick={() => navigate('/disputes/new')}
        >
          Create Dispute
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
                placeholder="Search disputes..."
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Type
                </label>
                <MultiSelect
                  options={typeOptions}
                  value={typeFilter}
                  onChange={setTypeFilter}
                  placeholder="All types"
                />
              </div>
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
                  Priority
                </label>
                <MultiSelect
                  options={priorityOptions}
                  value={priorityFilter}
                  onChange={setPriorityFilter}
                  placeholder="All priorities"
                />
              </div>
            </div>
            <div className="flex items-center justify-end mt-4 space-x-2">
              <Button variant="outline" size="sm" onClick={() => {
                setTypeFilter([]);
                setStatusFilter([]);
                setPriorityFilter([]);
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

      {/* Disputes table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
        <Table
          columns={columns}
          data={sortedDisputes}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          onRowClick={(dispute) => navigate(`/disputes/${dispute.id}`)}
          selectedRows={selectedRows}
          onSelectRow={handleSelectRow}
          onSelectAll={handleSelectAll}
          emptyMessage="No disputes found"
          searchable
          onSearch={setSearchQuery}
          searchPlaceholder="Search disputes..."
          pagination={{
            currentPage: 1,
            totalPages: Math.ceil(disputes.length / 10),
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
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Disputes Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">{disputes.length}</p>
            <p className="text-sm text-gray-500">Total</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-primary-600">
              {disputes.filter((d) => d.status === 'draft' || d.status === 'pending_review' || d.status === 'under_review').length}
            </p>
            <p className="text-sm text-gray-500">Pending</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-success-600">
              {disputes.filter((d) => d.status === 'ready_for_submission').length}
            </p>
            <p className="text-sm text-gray-500">Ready</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-warning-600">
              {disputes.filter((d) => d.status === 'submitted' || d.status === 'amazon_review').length}
            </p>
            <p className="text-sm text-gray-500">In Review</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-success-600">
              {disputes.filter((d) => d.status === 'approved').length}
            </p>
            <p className="text-sm text-gray-500">Approved</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-danger-600">
              {disputes.filter((d) => d.status === 'rejected').length}
            </p>
            <p className="text-sm text-gray-500">Rejected</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">
              ${disputes.reduce((sum, d) => sum + d.amount, 0).toFixed(2)}
            </p>
            <p className="text-sm text-gray-500">Total Amount</p>
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
              <BarChart3 size={20} className="text-primary-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Success Rate</p>
              <p className="text-xl font-bold text-gray-900">
                {disputes.length > 0 
                  ? `${Math.round((disputes.filter((d) => d.status === 'approved').length / disputes.length) * 100)}%`
                  : '0%'}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-success-100 rounded-lg flex items-center justify-center">
              <DollarSign size={20} className="text-success-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Avg. Amount</p>
              <p className="text-xl font-bold text-gray-900">
                ${disputes.length > 0 
                  ? (disputes.reduce((sum, d) => sum + d.amount, 0) / disputes.length).toFixed(2)
                  : '0.00'}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-warning-100 rounded-lg flex items-center justify-center">
              <Clock size={20} className="text-warning-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Avg. Resolution</p>
              <p className="text-xl font-bold text-gray-900">12.5 days</p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default DisputesPage;
