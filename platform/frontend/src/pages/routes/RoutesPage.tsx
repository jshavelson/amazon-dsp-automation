import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import {
  Route,
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
  MapPin,
  Clock,
  Users,
  Truck,
  CheckCircle,
  XCircle,
  Activity,
  BarChart3,
} from 'lucide-react';
import { useRoutes, useDeleteRoute } from '@/hooks/useRoutes';
import { Route as RouteType, RouteStatus } from '@/types/route';
import { Button, IconButton } from '@/components/shared/Button';
import { Input } from '@/components/shared/Input';
import { Select, MultiSelect } from '@/components/shared/Select';
import { Table, Column } from '@/components/shared/Table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Badge } from '@/components/shared/Badge';

const RoutesPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<RouteStatus[]>([]);
  const [dateFilter, setDateFilter] = useState('');
  const [sortBy, setSortBy] = useState<string>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Fetch routes data
  const { data: routesData, isLoading, error, refetch } = useRoutes({
    search: searchQuery,
    status: statusFilter.length > 0 ? statusFilter[0] : undefined,
    date: dateFilter || undefined,
    page: 1,
    limit: 50,
  });

  // Delete route mutation
  const { mutate: deleteRoute } = useDeleteRoute();

  // Route data
  const routes: RouteType[] = routesData?.data || [];

  // Status options
  const statusOptions: { value: RouteStatus; label: string }[] = [
    { value: 'planned', label: 'Planned' },
    { value: 'assigned', label: 'Assigned' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'on_break', label: 'On Break' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'delayed', label: 'Delayed' },
    { value: 'rescheduled', label: 'Rescheduled' },
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
    if (selectedRows.length === routes.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(routes.map((route) => route.id));
    }
  }, [selectedRows.length, routes]);

  // Handle delete selected
  const handleDeleteSelected = useCallback(() => {
    if (selectedRows.length === 0) return;
    
    if (window.confirm(`Are you sure you want to delete ${selectedRows.length} route(s)?`)) {
      selectedRows.forEach((id) => {
        deleteRoute(id);
      });
      setSelectedRows([]);
    }
  }, [selectedRows, deleteRoute]);

  // Handle delete single route
  const handleDeleteRoute = useCallback((id: string, routeNumber: string) => {
    if (window.confirm(`Are you sure you want to delete route ${routeNumber}?`)) {
      deleteRoute(id);
    }
  }, [deleteRoute]);

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

  // Sort routes
  const sortedRoutes = [...routes].sort((a, b) => {
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
  const columns: Column<RouteType>[] = [
    {
      key: 'routeNumber',
      header: 'Route #',
      sortable: true,
      width: '100px',
    },
    {
      key: 'routeName',
      header: 'Name',
      sortable: true,
    },
    {
      key: 'date',
      header: 'Date',
      sortable: true,
      width: '120px',
      render: (value) => (
        <span className="text-sm text-gray-600">
          {new Date(value).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'driverName',
      header: 'Driver',
      sortable: true,
    },
    {
      key: 'vanLicensePlate',
      header: 'Van',
      sortable: true,
      width: '100px',
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      width: '120px',
      render: (value) => (
        <Badge
          variant={{
            planned: 'secondary',
            assigned: 'info',
            in_progress: 'primary',
            on_break: 'warning',
            completed: 'success',
            cancelled: 'danger',
            delayed: 'warning',
            rescheduled: 'info',
          }[value as RouteStatus] || 'secondary'}
        >
          {value.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      key: 'startTime',
      header: 'Start Time',
      sortable: true,
      width: '100px',
      render: (value) => (
        <span className="text-sm text-gray-600">
          {value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
        </span>
      ),
    },
    {
      key: 'endTime',
      header: 'End Time',
      sortable: true,
      width: '100px',
      render: (value) => (
        <span className="text-sm text-gray-600">
          {value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
        </span>
      ),
    },
    {
      key: 'totalStops',
      header: 'Stops',
      sortable: true,
      width: '80px',
    },
    {
      key: 'totalPackages',
      header: 'Packages',
      sortable: true,
      width: '80px',
    },
    {
      key: 'totalMiles',
      header: 'Miles',
      sortable: true,
      width: '80px',
      render: (value) => (
        <span className="font-medium text-gray-900">
          {Number(value).toFixed(1)}
        </span>
      ),
    },
    {
      key: 'onTimeDeliveryRate',
      header: 'On-Time %',
      sortable: true,
      width: '100px',
      render: (value) => (
        <span className="font-medium text-gray-900">
          {Number(value).toFixed(1)}%
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
            ariaLabel="View route"
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/routes/${row.id}`)}
          />
          <IconButton
            icon={<Edit size={16} />}
            ariaLabel="Edit route"
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/routes/${row.id}/edit`)}
          />
          <IconButton
            icon={<Trash2 size={16} />}
            ariaLabel="Delete route"
            variant="ghost"
            size="sm"
            className="text-danger-600 hover:text-danger-700"
            onClick={() => handleDeleteRoute(row.id, row.routeNumber)}
          />
        </div>
      ),
    },
  ];

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner size="lg" text="Loading routes..." />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <p className="text-danger-600 mb-4">Failed to load routes</p>
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
          <h1 className="text-2xl font-bold text-gray-900">Routes</h1>
          <p className="text-gray-500 mt-1">Manage and track delivery routes</p>
        </div>
        <Button
          leftIcon={<Plus size={16} />}
          onClick={() => navigate('/routes/new')}
        >
          Create Route
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
                placeholder="Search routes..."
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
                  Date
                </label>
                <Input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Driver
                </label>
                <Select
                  options={Array.from(new Set(routes.map((r) => ({ value: r.driverId, label: r.driverName }))))}
                  value={''}
                  onChange={() => {}}
                  placeholder="All drivers"
                />
              </div>
            </div>
            <div className="flex items-center justify-end mt-4 space-x-2">
              <Button variant="outline" size="sm" onClick={() => {
                setStatusFilter([]);
                setDateFilter('');
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

      {/* Routes table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
        <Table
          columns={columns}
          data={sortedRoutes}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          onRowClick={(route) => navigate(`/routes/${route.id}`)}
          selectedRows={selectedRows}
          onSelectRow={handleSelectRow}
          onSelectAll={handleSelectAll}
          emptyMessage="No routes found"
          searchable
          onSearch={setSearchQuery}
          searchPlaceholder="Search routes..."
          pagination={{
            currentPage: 1,
            totalPages: Math.ceil(routes.length / 10),
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
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Routes Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">{routes.length}</p>
            <p className="text-sm text-gray-500">Total Routes</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-primary-600">
              {routes.filter((r) => r.status === 'planned' || r.status === 'assigned').length}
            </p>
            <p className="text-sm text-gray-500">Planned</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-warning-600">
              {routes.filter((r) => r.status === 'in_progress' || r.status === 'on_break').length}
            </p>
            <p className="text-sm text-gray-500">In Progress</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-success-600">
              {routes.filter((r) => r.status === 'completed').length}
            </p>
            <p className="text-sm text-gray-500">Completed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-danger-600">
              {routes.filter((r) => r.status === 'cancelled').length}
            </p>
            <p className="text-sm text-gray-500">Cancelled</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">
              {routes.reduce((sum, r) => sum + r.totalStops, 0).toLocaleString()}
            </p>
            <p className="text-sm text-gray-500">Total Stops</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">
              {routes.reduce((sum, r) => sum + r.totalMiles, 0).toFixed(1)}
            </p>
            <p className="text-sm text-gray-500">Total Miles</p>
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
              <Users size={20} className="text-primary-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Unique Drivers</p>
              <p className="text-xl font-bold text-gray-900">
                {Array.from(new Set(routes.map((r) => r.driverId))).length}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-success-100 rounded-lg flex items-center justify-center">
              <Truck size={20} className="text-success-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Unique Vans</p>
              <p className="text-xl font-bold text-gray-900">
                {Array.from(new Set(routes.map((r) => r.vanId))).length}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-warning-100 rounded-lg flex items-center justify-center">
              <BarChart3 size={20} className="text-warning-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Avg. On-Time %</p>
              <p className="text-xl font-bold text-gray-900">
                {routes.length > 0 
                  ? `${(routes.reduce((sum, r) => sum + r.onTimeDeliveryRate, 0) / routes.length).toFixed(1)}%`
                  : '0%'}
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default RoutesPage;
