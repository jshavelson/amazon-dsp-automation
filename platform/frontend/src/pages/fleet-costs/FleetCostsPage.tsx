import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Filter, Download, MoreVertical, Edit, Trash2, Eye, Search } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/shared/DataTable';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import { BarChart, LineChart, PieChart } from '@/components/charts';
import { Modal, ConfirmModal } from '@/components/modals';
import { Form, FormInput, FormSelect } from '@/components/forms';
import { fleetCostApi } from '@/services/api';
import {
  FleetCost,
  FleetCostSummary,
  CostTrend,
  CostBudget,
  CostForecast,
  FuelCostAnalysis,
  MaintenanceCostAnalysis,
  CostType,
  CostCategory,
  CostStatus,
  AllocationTarget,
  AllocationMethod,
  PaymentMethod,
} from '@/types/fleet-costs';
import { PaginatedResponse, FilterParams, SelectOption } from '@/types/common';
import { toast } from 'sonner';

// Query keys for React Query
const FLEET_COSTS_QUERY_KEYS = {
  ALL: ['fleet-costs'] as const,
  LIST: (params?: FilterParams) => ['fleet-costs', 'list', params] as const,
  SUMMARY: (period?: string) => ['fleet-costs', 'summary', period] as const,
  FUEL_ANALYSIS: (period?: string) => ['fleet-costs', 'fuel-analysis', period] as const,
  MAINTENANCE_ANALYSIS: (period?: string) => ['fleet-costs', 'maintenance-analysis', period] as const,
  TRENDS: (period?: string) => ['fleet-costs', 'trends', period] as const,
  BUDGETS: (period?: string) => ['fleet-costs', 'budgets', period] as const,
  FORECASTS: (period?: string) => ['fleet-costs', 'forecasts', period] as const,
};

// Cost type options
const COST_TYPE_OPTIONS: SelectOption[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'variable', label: 'Variable' },
  { value: 'capital', label: 'Capital' },
  { value: 'operating', label: 'Operating' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'labor', label: 'Labor' },
];

// Cost category options
const COST_CATEGORY_OPTIONS: SelectOption[] = [
  { value: 'fuel', label: 'Fuel' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'leasing', label: 'Leasing' },
  { value: 'depreciation', label: 'Depreciation' },
  { value: 'tolls', label: 'Tolls' },
  { value: 'parking', label: 'Parking' },
  { value: 'tires', label: 'Tires' },
  { value: 'batteries', label: 'Batteries' },
  { value: 'repairs', label: 'Repairs' },
  { value: 'washes', label: 'Washes' },
  { value: 'inspections', label: 'Inspections' },
  { value: 'registrations', label: 'Registrations' },
  { value: 'taxes', label: 'Taxes' },
  { value: 'financing', label: 'Financing' },
  { value: 'storage', label: 'Storage' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'software', label: 'Software' },
  { value: 'training', label: 'Training' },
  { value: 'safety', label: 'Safety' },
  { value: 'other', label: 'Other' },
];

// Status options
const STATUS_OPTIONS: SelectOption[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'reimbursed', label: 'Reimbursed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

// Allocation target options
const ALLOCATION_TARGET_OPTIONS: SelectOption[] = [
  { value: 'dsp', label: 'DSP' },
  { value: 'van', label: 'Van' },
  { value: 'driver', label: 'Driver' },
  { value: 'route', label: 'Route' },
  { value: 'team', label: 'Team' },
];

// Allocation method options
const ALLOCATION_METHOD_OPTIONS: SelectOption[] = [
  { value: 'direct', label: 'Direct' },
  { value: 'per_mile', label: 'Per Mile' },
  { value: 'per_hour', label: 'Per Hour' },
  { value: 'per_route', label: 'Per Route' },
  { value: 'per_van', label: 'Per Van' },
  { value: 'per_driver', label: 'Per Driver' },
  { value: 'percentage', label: 'Percentage' },
];

// Payment method options
const PAYMENT_METHOD_OPTIONS: SelectOption[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'debit_card', label: 'Debit Card' },
  { value: 'check', label: 'Check' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'company_card', label: 'Company Card' },
  { value: 'reimbursement', label: 'Reimbursement' },
];

// FleetCostsPage component
const FleetCostsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<FilterParams>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date } | undefined>();
  const [selectedCostType, setSelectedCostType] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('current-month');
  
  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedCost, setSelectedCost] = useState<FleetCost | null>(null);
  const [deleteCostId, setDeleteCostId] = useState<string>('');

  // Fetch fleet costs
  const {
    data: fleetCostsData,
    isLoading: isLoadingCosts,
    error: costsError,
  } = useQuery<PaginatedResponse<FleetCost>>({
    queryKey: FLEET_COSTS_QUERY_KEYS.LIST(filters),
    queryFn: async () => {
      const params: Record<string, unknown> = { ...filters };
      if (searchQuery) params.search = searchQuery;
      if (selectedCostType) params.costType = selectedCostType;
      if (selectedCategory) params.costCategory = selectedCategory;
      if (selectedStatus) params.status = selectedStatus;
      if (dateRange) {
        params.startDate = dateRange.from.toISOString().split('T')[0];
        params.endDate = dateRange.to.toISOString().split('T')[0];
      }
      return fleetCostApi.getAll(params);
    },
  });

  // Fetch fleet cost summary
  const {
    data: summaryData,
    isLoading: isLoadingSummary,
    error: summaryError,
  } = useQuery<FleetCostSummary>({
    queryKey: FLEET_COSTS_QUERY_KEYS.SUMMARY(selectedPeriod),
    queryFn: () => fleetCostApi.getSummary({ period: selectedPeriod }),
  });

  // Fetch fuel analysis
  const {
    data: fuelAnalysisData,
    isLoading: isLoadingFuelAnalysis,
  } = useQuery<FuelCostAnalysis>({
    queryKey: FLEET_COSTS_QUERY_KEYS.FUEL_ANALYSIS(selectedPeriod),
    queryFn: () => fleetCostApi.getFuelAnalysis({ period: selectedPeriod }),
  });

  // Fetch maintenance analysis
  const {
    data: maintenanceAnalysisData,
    isLoading: isLoadingMaintenanceAnalysis,
  } = useQuery<MaintenanceCostAnalysis>({
    queryKey: FLEET_COSTS_QUERY_KEYS.MAINTENANCE_ANALYSIS(selectedPeriod),
    queryFn: () => fleetCostApi.getMaintenanceAnalysis({ period: selectedPeriod }),
  });

  // Fetch cost trends
  const {
    data: trendsData,
    isLoading: isLoadingTrends,
  } = useQuery<CostTrend[]>({
    queryKey: FLEET_COSTS_QUERY_KEYS.TRENDS(selectedPeriod),
    queryFn: () => fleetCostApi.getTrends({ period: selectedPeriod }),
  });

  // Fetch budgets
  const {
    data: budgetsData,
    isLoading: isLoadingBudgets,
  } = useQuery<CostBudget[]>({
    queryKey: FLEET_COSTS_QUERY_KEYS.BUDGETS(selectedPeriod),
    queryFn: () => fleetCostApi.getBudgets({ period: selectedPeriod }),
  });

  // Fetch forecasts
  const {
    data: forecastsData,
    isLoading: isLoadingForecasts,
  } = useQuery<CostForecast[]>({
    queryKey: FLEET_COSTS_QUERY_KEYS.FORECASTS(selectedPeriod),
    queryFn: () => fleetCostApi.getForecasts({ period: selectedPeriod }),
  });

  // Create fleet cost mutation
  const createFleetCostMutation = useMutation({
    mutationFn: fleetCostApi.create,
    onSuccess: () => {
      toast.success('Fleet cost created successfully');
      queryClient.invalidateQueries({ queryKey: FLEET_COSTS_QUERY_KEYS.ALL });
      setIsAddModalOpen(false);
    },
    onError: (error: Error) => {
      toast.error(`Failed to create fleet cost: ${error.message}`);
    },
  });

  // Update fleet cost mutation
  const updateFleetCostMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FleetCost> }) =>
      fleetCostApi.update(id, data),
    onSuccess: () => {
      toast.success('Fleet cost updated successfully');
      queryClient.invalidateQueries({ queryKey: FLEET_COSTS_QUERY_KEYS.ALL });
      setIsEditModalOpen(false);
      setSelectedCost(null);
    },
    onError: (error: Error) => {
      toast.error(`Failed to update fleet cost: ${error.message}`);
    },
  });

  // Delete fleet cost mutation
  const deleteFleetCostMutation = useMutation({
    mutationFn: fleetCostApi.delete,
    onSuccess: () => {
      toast.success('Fleet cost deleted successfully');
      queryClient.invalidateQueries({ queryKey: FLEET_COSTS_QUERY_KEYS.ALL });
      setIsDeleteModalOpen(false);
      setDeleteCostId('');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete fleet cost: ${error.message}`);
    },
  });

  // Handle filter changes
  const handleFilterChange = useCallback((newFilters: FilterParams) => {
    setFilters(newFilters);
  }, []);

  // Handle search
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  // Handle date range change
  const handleDateRangeChange = useCallback((range: { from: Date; to: Date } | undefined) => {
    setDateRange(range);
  }, []);

  // Handle period change
  const handlePeriodChange = useCallback((period: string) => {
    setSelectedPeriod(period);
  }, []);

  // Handle add new cost
  const handleAddCost = useCallback((data: Partial<FleetCost>) => {
    createFleetCostMutation.mutate(data as FleetCost);
  }, [createFleetCostMutation]);

  // Handle edit cost
  const handleEditCost = useCallback((data: Partial<FleetCost>) => {
    if (selectedCost) {
      updateFleetCostMutation.mutate({ id: selectedCost.id, data });
    }
  }, [selectedCost, updateFleetCostMutation]);

  // Handle delete cost
  const handleDeleteCost = useCallback(() => {
    if (deleteCostId) {
      deleteFleetCostMutation.mutate(deleteCostId);
    }
  }, [deleteCostId, deleteFleetCostMutation]);

  // Handle view cost
  const handleViewCost = useCallback((cost: FleetCost) => {
    setSelectedCost(cost);
    setIsViewModalOpen(true);
  }, []);

  // Handle edit modal open
  const handleEditModalOpen = useCallback((cost: FleetCost) => {
    setSelectedCost(cost);
    setIsEditModalOpen(true);
  }, []);

  // Handle delete modal open
  const handleDeleteModalOpen = useCallback((costId: string) => {
    setDeleteCostId(costId);
    setIsDeleteModalOpen(true);
  }, []);

  // Get status badge variant
  const getStatusBadgeVariant = useCallback((status: CostStatus) => {
    switch (status) {
      case 'paid':
        return 'success';
      case 'approved':
        return 'info';
      case 'pending':
        return 'warning';
      case 'rejected':
      case 'cancelled':
        return 'destructive';
      case 'reimbursed':
        return 'secondary';
      default:
        return 'default';
    }
  }, []);

  // Format currency
  const formatCurrency = useCallback((amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  }, []);

  // Format date
  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, []);

  // Columns for data table
  const columns = [
    {
      key: 'date',
      header: 'Date',
      sortable: true,
      render: (value: string) => formatDate(value),
    },
    {
      key: 'costType',
      header: 'Type',
      sortable: true,
      render: (value: CostType) => (
        <Badge variant="outline" className="capitalize">
          {value.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      key: 'costCategory',
      header: 'Category',
      sortable: true,
      render: (value: CostCategory) => (
        <Badge variant="outline" className="capitalize">
          {value.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      sortable: true,
    },
    {
      key: 'amount',
      header: 'Amount',
      sortable: true,
      render: (value: number) => formatCurrency(value),
      className: 'text-right',
    },
    {
      key: 'totalAmount',
      header: 'Total',
      sortable: true,
      render: (value: number) => formatCurrency(value),
      className: 'text-right',
    },
    {
      key: 'vendor',
      header: 'Vendor',
      sortable: true,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (value: CostStatus) => (
        <Badge variant={getStatusBadgeVariant(value)} className="capitalize">
          {value.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (_: unknown, row: FleetCost) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleViewCost(row)}
            className="h-8 w-8 p-0"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleEditModalOpen(row)}
            className="h-8 w-8 p-0"
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDeleteModalOpen(row.id)}
            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  // Data for the table
  const tableData = fleetCostsData?.data || [];

  // Loading state
  const isLoading = isLoadingCosts || isLoadingSummary;

  // Error state
  const error = costsError || summaryError;

  // Prepare chart data
  const costByCategoryData = summaryData?.costByCategory
    ? Object.entries(summaryData.costByCategory).map(([category, amount]) => ({
        name: category.replace('_', ' '),
        value: amount,
      }))
    : [];

  const costTrendsData = trendsData?.map((trend) => ({
    period: trend.period,
    totalCost: trend.totalCost,
    costPerMile: trend.costPerMile,
    costPerDelivery: trend.costPerDelivery,
  })) || [];

  const budgetData = budgetsData?.map((budget) => ({
    category: budget.category.replace('_', ' '),
    budgeted: budget.budgetedAmount,
    actual: budget.actualAmount,
    variance: budget.variance,
  })) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fleet Costs</h1>
          <p className="text-muted-foreground">
            Manage and track all fleet-related expenses
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => {}}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button onClick={() => setIsAddModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Cost
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="costs">All Costs</TabsTrigger>
          <TabsTrigger value="fuel">Fuel Analysis</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="budgets">Budgets</TabsTrigger>
          <TabsTrigger value="forecasts">Forecasts</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          {isLoadingSummary ? (
            <LoadingSpinner />
          ) : summaryData ? (
            <>
              {/* Summary Cards */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      className="h-4 w-4 text-muted-foreground"
                    >
                      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(summaryData.totalCost)}</div>
                    <p className="text-xs text-muted-foreground">
                      {summaryData.period}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Fixed Cost</CardTitle>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      className="h-4 w-4 text-muted-foreground"
                    >
                      <rect width="20" height="14" x="2" y="5" rx="2" />
                      <path d="M2 10h20" />
                    </svg>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(summaryData.totalFixedCost)}</div>
                    <p className="text-xs text-muted-foreground">
                      Fixed expenses
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Variable Cost</CardTitle>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      className="h-4 w-4 text-muted-foreground"
                    >
                      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(summaryData.totalVariableCost)}</div>
                    <p className="text-xs text-muted-foreground">
                      Variable expenses
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Cost Per Mile</CardTitle>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      className="h-4 w-4 text-muted-foreground"
                    >
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(summaryData.costPerMile)}</div>
                    <p className="text-xs text-muted-foreground">
                      Per mile
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Charts */}
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Cost by Category</CardTitle>
                    <CardDescription>
                      Distribution of fleet costs by category
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <PieChart
                      data={costByCategoryData}
                      height={300}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Cost Trends</CardTitle>
                    <CardDescription>
                      Historical cost trends over time
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <LineChart
                      data={costTrendsData}
                      xKey="period"
                      yKeys={['totalCost', 'costPerMile', 'costPerDelivery']}
                      height={300}
                    />
                  </CardContent>
                </Card>
              </div>
            </>
          ) : null}
        </TabsContent>

        {/* All Costs Tab */}
        <TabsContent value="costs" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Search</label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search costs..."
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Cost Type</label>
                <Select
                  value={selectedCostType}
                  onValueChange={setSelectedCostType}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All types</SelectItem>
                    {COST_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Category</label>
                <Select
                  value={selectedCategory}
                  onValueChange={setSelectedCategory}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All categories</SelectItem>
                    {COST_CATEGORY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <Select
                  value={selectedStatus}
                  onValueChange={setSelectedStatus}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All statuses</SelectItem>
                    {STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Date Range</label>
                <DatePickerWithRange
                  dateRange={dateRange}
                  onDateRangeChange={handleDateRangeChange}
                />
              </div>
            </CardContent>
          </Card>

          {/* Data Table */}
          <Card>
            <CardHeader>
              <CardTitle>Fleet Costs</CardTitle>
              <CardDescription>
                {tableData.length} costs found
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingCosts ? (
                <LoadingSpinner />
              ) : error ? (
                <Alert variant="destructive">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>
                    Failed to load fleet costs. Please try again.
                  </AlertDescription>
                </Alert>
              ) : (
                <DataTable
                  columns={columns}
                  data={tableData}
                  pagination={fleetCostsData?.meta}
                  onPageChange={(page) => handleFilterChange({ ...filters, page })}
                  onSortChange={(sortBy, sortOrder) => handleFilterChange({ ...filters, sortBy, sortOrder })}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Fuel Analysis Tab */}
        <TabsContent value="fuel" className="space-y-4">
          {isLoadingFuelAnalysis ? (
            <LoadingSpinner />
          ) : fuelAnalysisData ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Fuel Cost Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4">
                    <div className="flex justify-between">
                      <span>Total Fuel Cost</span>
                      <span className="font-semibold">{formatCurrency(fuelAnalysisData.totalFuelCost)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Gallons</span>
                      <span className="font-semibold">{fuelAnalysisData.totalGallons.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Average Price Per Gallon</span>
                      <span className="font-semibold">{formatCurrency(fuelAnalysisData.averagePricePerGallon)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Miles</span>
                      <span className="font-semibold">{fuelAnalysisData.totalMiles.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Fuel Efficiency</span>
                      <span className="font-semibold">{fuelAnalysisData.fuelEfficiency.toFixed(2)} mpg</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cost Per Mile</span>
                      <span className="font-semibold">{formatCurrency(fuelAnalysisData.costPerMile)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Fuel Efficiency by Van</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarChart
                    data={fuelAnalysisData.byVan.map((van) => ({
                      vanId: van.vanId,
                      vanLicensePlate: van.vanLicensePlate,
                      fuelEfficiency: van.fuelEfficiency,
                      costPerMile: van.costPerMile,
                    }))}
                    xKey="vanLicensePlate"
                    yKeys={['fuelEfficiency', 'costPerMile']}
                    height={300}
                  />
                </CardContent>
              </Card>
            </div>
          ) : null}
        </TabsContent>

        {/* Maintenance Analysis Tab */}
        <TabsContent value="maintenance" className="space-y-4">
          {isLoadingMaintenanceAnalysis ? (
            <LoadingSpinner />
          ) : maintenanceAnalysisData ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Maintenance Cost Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4">
                    <div className="flex justify-between">
                      <span>Total Maintenance Cost</span>
                      <span className="font-semibold">{formatCurrency(maintenanceAnalysisData.totalMaintenanceCost)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Average Cost Per Mile</span>
                      <span className="font-semibold">{formatCurrency(maintenanceAnalysisData.averageCostPerMile)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Average Cost Per Van</span>
                      <span className="font-semibold">{formatCurrency(maintenanceAnalysisData.averageCostPerVan)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Maintenance Cost by Category</CardTitle>
                </CardHeader>
                <CardContent>
                  <PieChart
                    data={Object.entries(maintenanceAnalysisData.byCategory).map(([category, cost]) => ({
                      name: category.replace('_', ' '),
                      value: cost,
                    }))}
                    height={300}
                  />
                </CardContent>
              </Card>
            </div>
          ) : null}
        </TabsContent>

        {/* Budgets Tab */}
        <TabsContent value="budgets" className="space-y-4">
          {isLoadingBudgets ? (
            <LoadingSpinner />
          ) : budgetsData && budgetsData.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Cost Budgets</CardTitle>
              </CardHeader>
              <CardContent>
                <BarChart
                  data={budgetData}
                  xKey="category"
                  yKeys={['budgeted', 'actual', 'variance']}
                  height={400}
                />
              </CardContent>
            </Card>
          ) : (
            <Alert variant="info">
              <AlertTitle>No budgets found</AlertTitle>
              <AlertDescription>
                No budget data available for the selected period.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        {/* Forecasts Tab */}
        <TabsContent value="forecasts" className="space-y-4">
          {isLoadingForecasts ? (
            <LoadingSpinner />
          ) : forecastsData && forecastsData.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Cost Forecasts</CardTitle>
              </CardHeader>
              <CardContent>
                <LineChart
                  data={forecastsData.map((forecast) => ({
                    period: forecast.period,
                    forecastedCost: forecast.forecastedCost,
                    confidenceLevel: forecast.confidenceLevel,
                  }))}
                  xKey="period"
                  yKeys={['forecastedCost', 'confidenceLevel']}
                  height={400}
                />
              </CardContent>
            </Card>
          ) : (
            <Alert variant="info">
              <AlertTitle>No forecasts found</AlertTitle>
              <AlertDescription>
                No forecast data available for the selected period.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>
      </Tabs>

      {/* Add Cost Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add Fleet Cost"
        size="lg"
      >
        <Form onSubmit={handleAddCost}>
          <div className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <FormSelect
                name="costType"
                label="Cost Type"
                required
                options={COST_TYPE_OPTIONS}
              />
              <FormSelect
                name="costCategory"
                label="Category"
                required
                options={COST_CATEGORY_OPTIONS}
              />
            </div>
            <FormInput
              name="description"
              label="Description"
              required
              placeholder="Enter description"
            />
            <div className="grid gap-4 md:grid-cols-2">
              <FormInput
                name="amount"
                label="Amount"
                type="number"
                required
                placeholder="0.00"
              />
              <FormInput
                name="taxAmount"
                label="Tax Amount"
                type="number"
                placeholder="0.00"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormInput
                name="date"
                label="Date"
                type="date"
                required
              />
              <FormInput
                name="period"
                label="Period"
                placeholder="e.g., 2024-Q1"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormSelect
                name="vendor"
                label="Vendor"
                options={[
                  { value: 'amazon', label: 'Amazon' },
                  { value: 'fleetio', label: 'Fleetio' },
                  { value: 'local_vendor', label: 'Local Vendor' },
                ]}
              />
              <FormInput
                name="invoiceNumber"
                label="Invoice Number"
                placeholder="INV-001"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormSelect
                name="paymentMethod"
                label="Payment Method"
                options={PAYMENT_METHOD_OPTIONS}
              />
              <FormSelect
                name="status"
                label="Status"
                options={STATUS_OPTIONS}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormSelect
                name="allocatedTo"
                label="Allocated To"
                options={ALLOCATION_TARGET_OPTIONS}
              />
              <FormSelect
                name="allocationMethod"
                label="Allocation Method"
                options={ALLOCATION_METHOD_OPTIONS}
              />
            </div>
            <FormInput
              name="notes"
              label="Notes"
              placeholder="Additional notes"
            />
          </div>
          <div className="flex gap-2 justify-end mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsAddModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={createFleetCostMutation.isPending}>
              Save
            </Button>
          </div>
        </Form>
      </Modal>

      {/* Edit Cost Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedCost(null);
        }}
        title="Edit Fleet Cost"
        size="lg"
      >
        {selectedCost && (
          <Form onSubmit={handleEditCost}>
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <FormSelect
                  name="costType"
                  label="Cost Type"
                  required
                  options={COST_TYPE_OPTIONS}
                />
                <FormSelect
                  name="costCategory"
                  label="Category"
                  required
                  options={COST_CATEGORY_OPTIONS}
                />
              </div>
              <FormInput
                name="description"
                label="Description"
                required
                placeholder="Enter description"
              />
              <div className="grid gap-4 md:grid-cols-2">
                <FormInput
                  name="amount"
                  label="Amount"
                  type="number"
                  required
                  placeholder="0.00"
                />
                <FormInput
                  name="taxAmount"
                  label="Tax Amount"
                  type="number"
                  placeholder="0.00"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <FormInput
                  name="date"
                  label="Date"
                  type="date"
                  required
                />
                <FormInput
                  name="period"
                  label="Period"
                  placeholder="e.g., 2024-Q1"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <FormSelect
                  name="vendor"
                  label="Vendor"
                  options={[
                    { value: 'amazon', label: 'Amazon' },
                    { value: 'fleetio', label: 'Fleetio' },
                    { value: 'local_vendor', label: 'Local Vendor' },
                  ]}
                />
                <FormInput
                  name="invoiceNumber"
                  label="Invoice Number"
                  placeholder="INV-001"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <FormSelect
                  name="paymentMethod"
                  label="Payment Method"
                  options={PAYMENT_METHOD_OPTIONS}
                />
                <FormSelect
                  name="status"
                  label="Status"
                  options={STATUS_OPTIONS}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <FormSelect
                  name="allocatedTo"
                  label="Allocated To"
                  options={ALLOCATION_TARGET_OPTIONS}
                />
                <FormSelect
                  name="allocationMethod"
                  label="Allocation Method"
                  options={ALLOCATION_METHOD_OPTIONS}
                />
              </div>
              <FormInput
                name="notes"
                label="Notes"
                placeholder="Additional notes"
              />
            </div>
            <div className="flex gap-2 justify-end mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsEditModalOpen(false);
                  setSelectedCost(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" loading={updateFleetCostMutation.isPending}>
                Update
              </Button>
            </div>
          </Form>
        )}
      </Modal>

      {/* View Cost Modal */}
      <Modal
        isOpen={isViewModalOpen}
        onClose={() => {
          setIsViewModalOpen(false);
          setSelectedCost(null);
        }}
        title="Fleet Cost Details"
        size="lg"
      >
        {selectedCost && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Cost Type
                </label>
                <Badge variant="outline" className="capitalize">
                  {selectedCost.costType.replace('_', ' ')}
                </Badge>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Category
                </label>
                <Badge variant="outline" className="capitalize">
                  {selectedCost.costCategory.replace('_', ' ')}
                </Badge>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Description
              </label>
              <p>{selectedCost.description}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Amount
                </label>
                <p className="font-semibold">{formatCurrency(selectedCost.amount)}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Total Amount
                </label>
                <p className="font-semibold">{formatCurrency(selectedCost.totalAmount)}</p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Date
                </label>
                <p>{formatDate(selectedCost.date)}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Period
                </label>
                <p>{selectedCost.period}</p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Vendor
                </label>
                <p>{selectedCost.vendor}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Invoice Number
                </label>
                <p>{selectedCost.invoiceNumber || 'N/A'}</p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Payment Method
                </label>
                <Badge variant="outline" className="capitalize">
                  {selectedCost.paymentMethod.replace('_', ' ')}
                </Badge>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Status
                </label>
                <Badge variant={getStatusBadgeVariant(selectedCost.status)} className="capitalize">
                  {selectedCost.status.replace('_', ' ')}
                </Badge>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Allocated To
                </label>
                <Badge variant="outline" className="capitalize">
                  {selectedCost.allocatedTo.replace('_', ' ')}
                </Badge>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Allocation Method
                </label>
                <Badge variant="outline" className="capitalize">
                  {selectedCost.allocationMethod.replace('_', ' ')}
                </Badge>
              </div>
            </div>
            {selectedCost.notes && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Notes
                </label>
                <p>{selectedCost.notes}</p>
              </div>
            )}
            <div className="flex gap-2 justify-end pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setIsViewModalOpen(false);
                  setSelectedCost(null);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setDeleteCostId('');
        }}
        title="Delete Fleet Cost"
        description="Are you sure you want to delete this fleet cost? This action cannot be undone."
        confirmText="Delete"
        confirmVariant="destructive"
        onConfirm={handleDeleteCost}
        loading={deleteFleetCostMutation.isPending}
      />
    </div>
  );
};

export default FleetCostsPage;
