import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import {
  Truck,
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
  Fuel,
  Wrench,
  Calendar,
  MapPin,
} from 'lucide-react';
import { useVans, useDeleteVan } from '@/hooks/useVans';
import { Van, VanType, VanStatus, OwnershipType } from '@/types/van';
import { Button, IconButton } from '@/components/shared/Button';
import { Input } from '@/components/shared/Input';
import { Select, MultiSelect } from '@/components/shared/Select';
import { Table, Column } from '@/components/shared/Table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Badge } from '@/components/shared/Badge';

const VansPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<VanType[]>([]);
  const [statusFilter, setStatusFilter] = useState<VanStatus[]>([]);
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipType[]>([]);
  const [sortBy, setSortBy] = useState<string>('licensePlate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Fetch vans data
  const { data: vansData, isLoading, error, refetch } = useVans({
    search: searchQuery,
    type: typeFilter.length > 0 ? typeFilter[0] : undefined,
    status: statusFilter.length > 0 ? statusFilter[0] : undefined,
    ownership: ownershipFilter.length > 0 ? ownershipFilter[0] : undefined,
    page: 1,
    limit: 50,
  });

  // Delete van mutation
  const { mutate: deleteVan } = useDeleteVan();

  // Van data
  const vans: Van[] = vansData?.data || [];

  // Type options
  const typeOptions: { value: VanType; label: string }[] = [
    { value: 'cargo_van', label: 'Cargo Van' },
    { value: 'sprinter', label: 'Sprinter' },
    { value: 'box_truck', label: 'Box Truck' },
    { value: 'refrigerated', label: 'Refrigerated' },
    { value: 'electric', label: 'Electric' },
  ];

  // Status options
  const statusOptions: { value: VanStatus; label: string }[] = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'inspection', label: 'Inspection' },
    { value: 'reserved', label: 'Reserved' },
    { value: 'retired', label: 'Retired' },
  ];

  // Ownership options
  const ownershipOptions: { value: OwnershipType; label: string }[] = [
    { value: 'owned', label: 'Owned' },
    { value: 'leased', label: 'Leased' },
    { value: 'rented', label: 'Rented' },
    { value: 'amazon_lmr', label: 'Amazon LMR' },
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
    if (selectedRows.length === vans.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(vans.map((van) => van.id));
    }
  }, [selectedRows.length, vans]);

  // Handle delete selected
  const handleDeleteSelected = useCallback(() => {
    if (selectedRows.length === 0) return;
    
    if (window.confirm(`Are you sure you want to delete ${selectedRows.length} van(s)?`)) {
      selectedRows.forEach((id) => {
        deleteVan(id);
      });
      setSelectedRows([]);
    }
  }, [selectedRows, deleteVan]);

  // Handle delete single van
  const handleDeleteVan = useCallback((id: string, licensePlate: string) => {
    if (window.confirm(`Are you sure you want to delete van ${licensePlate}?`)) {
      deleteVan(id);
    }
  }, [deleteVan]);

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

  // Sort vans
  const sortedVans = [...vans].sort((a, b) => {
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
  const columns: Column<Van>[] = [
    {
      key: 'licensePlate',
      header: 'License Plate',
      sortable: true,
      width: '120px',
    },
    {
      key: 'vin',
      header: 'VIN',
      sortable: true,
      width: '150px',
    },
    {
      key: 'make',
      header: 'Make',
      sortable: true,
    },
    {
      key: 'model',
      header: 'Model',
      sortable: true,
    },
    {
      key: 'year',
      header: 'Year',
      sortable: true,
      width: '80px',
    },
    {
      key: 'type',
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
      key: 'ownership',
      header: 'Ownership',
      sortable: true,
      width: '120px',
      render: (value) => (
        <Badge variant="secondary">
          {value}
        </Badge>
      ),
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
            inactive: 'secondary',
            maintenance: 'warning',
            inspection: 'info',
            reserved: 'primary',
            retired: 'danger',
          }[value as VanStatus] || 'secondary'}
        >
          {value}
        </Badge>
      ),
    },
    {
      key: 'mileage',
      header: 'Mileage',
      sortable: true,
      width: '100px',
      render: (value) => (
        <span className="font-medium text-gray-900">
          {Number(value).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'currentDriverId',
      header: 'Driver',
      sortable: true,
      width: '150px',
      render: (value) => (
        <span className="text-sm text-gray-600">
          {value ? `Driver #${value.slice(-4)}` : 'Unassigned'}
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
            ariaLabel="View van"
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/vans/${row.id}`)}
          />
          <IconButton
            icon={<Edit size={16} />}
            ariaLabel="Edit van"
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/vans/${row.id}/edit`)}
          />
          <IconButton
            icon={<Trash2 size={16} />}
            ariaLabel="Delete van"
            variant="ghost"
            size="sm"
            className="text-danger-600 hover:text-danger-700"
            onClick={() => handleDeleteVan(row.id, row.licensePlate)}
          />
        </div>
      ),
    },
  ];

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading vans..." />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-danger-600 mb-4">Failed to load vans</p>
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
          <h1 className="text-2xl font-bold text-gray-900">Vans</h1>
          <p className="text-gray-500 mt-1">Manage your fleet</p>
        </div>
        <Button
          leftIcon={<Plus size={16} />}
          onClick={() => navigate('/vans/new')}
        >
          Add Van
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
                placeholder="Search vans..."
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
                  Ownership
                </label>
                <MultiSelect
                  options={ownershipOptions}
                  value={ownershipFilter}
                  onChange={setOwnershipFilter}
                  placeholder="All ownership"
                />
              </div>
            </div>
            <div className="flex items-center justify-end mt-4 space-x-2">
              <Button variant="outline" size="sm" onClick={() => {
                setTypeFilter([]);
                setStatusFilter([]);
                setOwnershipFilter([]);
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

      {/* Vans table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
        <Table
          columns={columns}
          data={sortedVans}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          onRowClick={(van) => navigate(`/vans/${van.id}`)}
          selectedRows={selectedRows}
          onSelectRow={handleSelectRow}
          onSelectAll={handleSelectAll}
          emptyMessage="No vans found"
          searchable
          onSearch={setSearchQuery}
          searchPlaceholder="Search vans..."
          pagination={{
            currentPage: 1,
            totalPages: Math.ceil(vans.length / 10),
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
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Fleet Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">{vans.length}</p>
            <p className="text-sm text-gray-500">Total Vans</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-success-600">
              {vans.filter((v) => v.status === 'active').length}
            </p>
            <p className="text-sm text-gray-500">Active</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-warning-600">
              {vans.filter((v) => v.status === 'maintenance').length}
            </p>
            <p className="text-sm text-gray-500">Maintenance</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-info-600">
              {vans.filter((v) => v.status === 'inspection').length}
            </p>
            <p className="text-sm text-gray-500">Inspection</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-primary-600">
              {vans.filter((v) => v.ownership === 'owned').length}
            </p>
            <p className="text-sm text-gray-500">Owned</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-secondary-600">
              {vans.filter((v) => v.ownership === 'amazon_lmr').length}
            </p>
            <p className="text-sm text-gray-500">Amazon LMR</p>
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
              <p className="text-sm text-gray-500">Avg. Age</p>
              <p className="text-xl font-bold text-gray-900">
                {vans.length > 0 
                  ? `${Math.round(vans.reduce((sum, van) => sum + (new Date().getFullYear() - van.year), 0) / vans.length)} years`
                  : 'N/A'}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-success-100 rounded-lg flex items-center justify-center">
              <MapPin size={20} className="text-success-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Mileage</p>
              <p className="text-xl font-bold text-gray-900">
                {vans.reduce((sum, van) => sum + van.mileage, 0).toLocaleString()} miles
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-warning-100 rounded-lg flex items-center justify-center">
              <Fuel size={20} className="text-warning-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Avg. Fuel Level</p>
              <p className="text-xl font-bold text-gray-900">
                {vans.length > 0 
                  ? `${Math.round(vans.reduce((sum, van) => sum + van.currentFuelLevel, 0) / vans.length)}%`
                  : 'N/A'}
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default VansPage;
