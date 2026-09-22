import React, { useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import {
  BarChart3,
  Users,
  Truck,
  TrendingUp,
  TrendingDown,
  Clock,
  Star,
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Search,
  Filter,
  MoreVertical,
  Calendar,
  Eye,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react';
import { usePerformanceDashboard } from '@/hooks/usePerformance';
import { DriverPerformanceScore, TeamPerformance, DSPPerformance, PerformanceAlert } from '@/types/performance';
import { Button, IconButton } from '@/components/shared/Button';
import { Input } from '@/components/shared/Input';
import { Select } from '@/components/shared/Select';
import { Table, Column } from '@/components/shared/Table';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Badge } from '@/components/shared/Badge';

const PerformancePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [periodFilter, setPeriodFilter] = useState('week');
  const [sortBy, setSortBy] = useState<string>('overallScore');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Fetch performance data
  const { data: dashboardData, isLoading: isDashboardLoading, error: dashboardError, refetch: refetchDashboard } = usePerformanceDashboard(periodFilter);
  const connectedData = dashboardData as (typeof dashboardData & { drivers?: DriverPerformanceScore[]; generatedAt?: string; source?: string }) | undefined;
  const drivers = useMemo(() => connectedData?.drivers || [
    ...(dashboardData?.topDrivers || []), ...(dashboardData?.bottomDrivers || [])
  ].filter((row, index, all) => all.findIndex((candidate) => candidate.driverId === row.driverId) === index), [connectedData?.drivers, dashboardData?.topDrivers, dashboardData?.bottomDrivers]);
  const teams: TeamPerformance[] = dashboardData?.teamPerformance || [];
  const dspPerformance: DSPPerformance | null = dashboardData?.dspPerformance || null;
  const alerts: PerformanceAlert[] = [];

  /* Legacy demo fixture removed from execution; retained temporarily for a focused cleanup diff.
  // Load mock data
  useEffect(() => {
    // Mock drivers
    const mockDrivers = [
      {
        driverId: '1',
        driverName: 'John Smith',
        week: '2026-W38',
        year: 2026,
        onTimeDeliveryRate: 98.5,
        packagesPerHour: 45.2,
        milesPerHour: 32.8,
        safetyIncidents: 0,
        customerComplaints: 1,
        routeCompletionRate: 99.8,
        overtimeHours: 2.5,
        fuelEfficiency: 24.5,
        score: 95.2,
        grade: 'A',
      },
      {
        driverId: '2',
        driverName: 'Jane Doe',
        week: '2026-W38',
        year: 2026,
        onTimeDeliveryRate: 97.8,
        packagesPerHour: 42.1,
        milesPerHour: 30.5,
        safetyIncidents: 0,
        customerComplaints: 0,
        routeCompletionRate: 99.5,
        overtimeHours: 1.8,
        fuelEfficiency: 25.1,
        score: 93.8,
        grade: 'A',
      },
      {
        driverId: '3',
        driverName: 'Mike Johnson',
        week: '2026-W38',
        year: 2026,
        onTimeDeliveryRate: 95.2,
        packagesPerHour: 38.7,
        milesPerHour: 28.3,
        safetyIncidents: 1,
        customerComplaints: 2,
        routeCompletionRate: 97.2,
        overtimeHours: 4.2,
        fuelEfficiency: 22.8,
        score: 85.4,
        grade: 'B',
      },
      {
        driverId: '4',
        driverName: 'Sarah Williams',
        week: '2026-W38',
        year: 2026,
        onTimeDeliveryRate: 99.1,
        packagesPerHour: 48.3,
        milesPerHour: 34.2,
        safetyIncidents: 0,
        customerComplaints: 0,
        routeCompletionRate: 100,
        overtimeHours: 0,
        fuelEfficiency: 26.3,
        score: 98.5,
        grade: 'A',
      },
      {
        driverId: '5',
        driverName: 'David Brown',
        week: '2026-W38',
        year: 2026,
        onTimeDeliveryRate: 92.8,
        packagesPerHour: 35.6,
        milesPerHour: 26.8,
        safetyIncidents: 2,
        customerComplaints: 3,
        routeCompletionRate: 94.5,
        overtimeHours: 6.8,
        fuelEfficiency: 21.2,
        score: 78.2,
        grade: 'C',
      },
    ];

    // Mock teams
    const mockTeams: TeamPerformance[] = [
      {
        teamId: '1',
        teamName: 'Team Alpha',
        period: '2026-W38',
        driverCount: 15,
        averageOverallScore: 92.4,
        averageDeliveryScore: 94.1,
        averageSafetyScore: 90.8,
        averageEfficiencyScore: 91.2,
        averageQualityScore: 93.5,
        averageCostScore: 89.7,
        averageComplianceScore: 95.2,
        topPerformers: [mockDrivers[0], mockDrivers[3]] as unknown as DriverPerformanceScore[],
        bottomPerformers: [mockDrivers[4]] as unknown as DriverPerformanceScore[],
        trend: 'improving',
      },
      {
        teamId: '2',
        teamName: 'Team Beta',
        period: '2026-W38',
        driverCount: 12,
        averageOverallScore: 88.7,
        averageDeliveryScore: 90.2,
        averageSafetyScore: 87.5,
        averageEfficiencyScore: 88.9,
        averageQualityScore: 89.1,
        averageCostScore: 86.3,
        averageComplianceScore: 91.8,
        topPerformers: [mockDrivers[1]] as unknown as DriverPerformanceScore[],
        bottomPerformers: [mockDrivers[2]] as unknown as DriverPerformanceScore[],
        trend: 'stable',
      },
      {
        teamId: '3',
        teamName: 'Team Gamma',
        period: '2026-W38',
        driverCount: 18,
        averageOverallScore: 94.2,
        averageDeliveryScore: 95.8,
        averageSafetyScore: 93.1,
        averageEfficiencyScore: 94.5,
        averageQualityScore: 95.3,
        averageCostScore: 92.7,
        averageComplianceScore: 96.4,
        topPerformers: [mockDrivers[3]] as unknown as DriverPerformanceScore[],
        bottomPerformers: [],
        trend: 'improving',
      },
    ];

    // Mock DSP performance
    const mockDspPerformance: DSPPerformance = {
      dspId: '1',
      period: '2026-W38',
      overallScore: 91.8,
      deliveryScore: 93.5,
      safetyScore: 89.2,
      efficiencyScore: 91.4,
      qualityScore: 92.7,
      costScore: 88.9,
      complianceScore: 94.1,
      driverCount: 45,
      vanCount: 28,
      routeCount: 156,
      totalMiles: 45280,
      totalDeliveries: 12456,
      onTimeDeliveryRate: 96.8,
      customerSatisfaction: 4.7,
      costPerDelivery: 1.85,
      profitMargin: 12.5,
      safetyIncidentRate: 0.02,
      retentionRate: 92.3,
      utilizationRate: 87.5,
    };

    // Mock alerts
    const mockAlerts: PerformanceAlert[] = [
      {
        id: '1',
        driverId: '5',
        driverName: 'David Brown',
        metricId: 'safety',
        metricName: 'Safety Incidents',
        category: 'safety',
        alertType: 'above_target',
        currentValue: 2,
        targetValue: 0,
        threshold: 1,
        severity: 'high',
        message: 'David Brown has 2 safety incidents this week, which is above the target of 0.',
        triggeredAt: new Date(Date.now() - 3600000).toISOString(),
        acknowledged: false,
        resolved: false,
      },
      {
        id: '2',
        driverId: '3',
        driverName: 'Mike Johnson',
        metricId: 'on_time_delivery',
        metricName: 'On-Time Delivery',
        category: 'delivery',
        alertType: 'below_target',
        currentValue: 95.2,
        targetValue: 98,
        threshold: 95,
        severity: 'medium',
        message: 'Mike Johnson on-time delivery rate is below target.',
        triggeredAt: new Date(Date.now() - 7200000).toISOString(),
        acknowledged: true,
        resolved: false,
      },
      {
        id: '3',
        driverId: '4',
        driverName: 'Sarah Williams',
        metricId: 'fuel_efficiency',
        metricName: 'Fuel Efficiency',
        category: 'efficiency',
        alertType: 'above_target',
        currentValue: 26.3,
        targetValue: 24,
        threshold: 25,
        severity: 'low',
        message: 'Sarah Williams has excellent fuel efficiency this week.',
        triggeredAt: new Date(Date.now() - 10800000).toISOString(),
        acknowledged: true,
        resolved: true,
      },
    ];

    const normalizedDrivers = mockDrivers.map((driver, index) => {
      const legacy = driver as unknown as {
        week: string; score: number; grade: string; onTimeDeliveryRate: number;
        packagesPerHour: number; safetyIncidents: number; customerComplaints: number;
        routeCompletionRate: number; fuelEfficiency: number;
      };
      return {
        ...driver,
        period: legacy.week,
        metrics: [],
        overallScore: legacy.score,
        deliveryScore: legacy.onTimeDeliveryRate,
        safetyScore: Math.max(0, 100 - legacy.safetyIncidents * 15),
        efficiencyScore: Math.min(100, legacy.packagesPerHour * 2),
        qualityScore: Math.max(0, 100 - legacy.customerComplaints * 8),
        costScore: Math.min(100, legacy.fuelEfficiency * 4),
        complianceScore: legacy.routeCompletionRate,
        rank: index + 1,
        percentile: Math.round((mockDrivers.length - index) / mockDrivers.length * 100),
        trend: 'stable' as const,
      } as DriverPerformanceScore & { grade: string; onTimeDeliveryRate: number; safetyIncidents: number; customerComplaints: number };
    });
    const normalizedById = new Map(normalizedDrivers.map((driver) => [driver.driverId, driver]));
    const normalizedTeams = mockTeams.map((team) => ({
      ...team,
      topPerformers: team.topPerformers.map((driver) => normalizedById.get(driver.driverId) || driver),
      bottomPerformers: team.bottomPerformers.map((driver) => normalizedById.get(driver.driverId) || driver),
    }));

    setDrivers(normalizedDrivers);
    setTeams(normalizedTeams);
    setDspPerformance(mockDspPerformance);
    setAlerts(mockAlerts);
  }, []);
  */

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
      setSelectedRows(drivers.map((driver) => driver.driverId));
    }
  }, [selectedRows.length, drivers]);

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

  // Table columns for drivers
  const driverColumns: Column<DriverPerformanceScore>[] = [
    {
      key: 'driverName',
      header: 'Driver',
      sortable: true,
    },
    {
      key: 'overallScore',
      header: 'Overall Score',
      sortable: true,
      width: '120px',
      render: (value) => (
        <span className="font-medium text-gray-900">{Number(value).toFixed(1)}</span>
      ),
    },
    {
      key: 'grade',
      header: 'Grade',
      sortable: true,
      width: '80px',
      render: (value) => (
        <Badge
          variant={({
            A: 'success',
            B: 'primary',
            C: 'warning',
            D: 'danger',
            F: 'danger',
          } as const)[value as 'A' | 'B' | 'C' | 'D' | 'F'] || 'secondary'}
        >
          {String(value ?? '')}
        </Badge>
      ),
    },
    {
      key: 'deliveryScore',
      header: 'Delivery',
      sortable: true,
      width: '100px',
      render: (value) => (
        <span className="font-medium text-gray-900">{Number(value).toFixed(1)}</span>
      ),
    },
    {
      key: 'safetyScore',
      header: 'Safety',
      sortable: true,
      width: '100px',
      render: (value) => (
        <span className="font-medium text-gray-900">{Number(value).toFixed(1)}</span>
      ),
    },
    {
      key: 'efficiencyScore',
      header: 'Efficiency',
      sortable: true,
      width: '100px',
      render: (value) => (
        <span className="font-medium text-gray-900">{Number(value).toFixed(1)}</span>
      ),
    },
    {
      key: 'qualityScore',
      header: 'Quality',
      sortable: true,
      width: '100px',
      render: (value) => (
        <span className="font-medium text-gray-900">{Number(value).toFixed(1)}</span>
      ),
    },
    {
      key: 'onTimeDeliveryRate',
      header: 'On-Time %',
      sortable: true,
      width: '100px',
      render: (value) => (
        <span className="font-medium text-gray-900">{Number(value).toFixed(1)}%</span>
      ),
    },
    {
      key: 'safetyIncidents',
      header: 'Incidents',
      sortable: true,
      width: '80px',
    },
    {
      key: 'customerComplaints',
      header: 'Complaints',
      sortable: true,
      width: '80px',
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '80px',
      render: (_, row) => (
        <div className="flex items-center space-x-1">
          <IconButton
            icon={<Eye size={16} />}
            ariaLabel="View performance"
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/drivers/${row.driverId}`)}
          />
        </div>
      ),
    },
  ];

  // Period options
  const periodOptions = [
    { value: 'day', label: 'Today' },
    { value: 'week', label: 'This Week' },
    { value: 'month', label: 'This Month' },
    { value: 'quarter', label: 'This Quarter' },
    { value: 'year', label: 'This Year' },
  ];

  // Loading state
  if (isDashboardLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner size="lg" text="Loading performance data..." />
      </div>
    );
  }

  // Error state
  if (dashboardError) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <p className="text-danger-600 mb-4">Failed to load performance data</p>
          <Button onClick={() => {
            refetchDashboard();
          }}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Performance</h1>
          <p className="text-gray-500 mt-1">Track and analyze driver and team performance</p>
        </div>
        <div className="flex items-center space-x-2">
          <Select
            options={periodOptions}
            value={periodFilter}
            onChange={setPeriodFilter}
            className="w-48"
          />
          <Button leftIcon={<BarChart3 size={16} />}>
            Export Report
          </Button>
        </div>
      </div>

      {/* DSP Performance Overview */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-6">DSP Performance Overview</h3>
        
        {dspPerformance && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="text-center">
              <p className="text-sm text-gray-500 mb-1">Overall Score</p>
              <div className="flex items-center justify-center space-x-2">
                <span className="text-2xl font-bold text-gray-900">{dspPerformance.overallScore.toFixed(1)}</span>
                <span className="text-sm">/100</span>
              </div>
              <div className="mt-2 h-1 bg-gray-200 rounded-full">
                <div
                  className="h-1 bg-primary-600 rounded-full"
                  style={{ width: `${dspPerformance.overallScore}%` }}
                />
              </div>
            </div>
            
            <div className="text-center">
              <p className="text-sm text-gray-500 mb-1">Delivery</p>
              <div className="flex items-center justify-center space-x-2">
                <span className="text-2xl font-bold text-primary-600">{dspPerformance.deliveryScore.toFixed(1)}</span>
                <span className="text-sm">/100</span>
              </div>
              <div className="mt-2 h-1 bg-gray-200 rounded-full">
                <div
                  className="h-1 bg-primary-600 rounded-full"
                  style={{ width: `${dspPerformance.deliveryScore}%` }}
                />
              </div>
            </div>
            
            <div className="text-center">
              <p className="text-sm text-gray-500 mb-1">Safety</p>
              <div className="flex items-center justify-center space-x-2">
                <span className="text-2xl font-bold text-success-600">{dspPerformance.safetyScore.toFixed(1)}</span>
                <span className="text-sm">/100</span>
              </div>
              <div className="mt-2 h-1 bg-gray-200 rounded-full">
                <div
                  className="h-1 bg-success-600 rounded-full"
                  style={{ width: `${dspPerformance.safetyScore}%` }}
                />
              </div>
            </div>
            
            <div className="text-center">
              <p className="text-sm text-gray-500 mb-1">Efficiency</p>
              <div className="flex items-center justify-center space-x-2">
                <span className="text-2xl font-bold text-warning-600">{dspPerformance.efficiencyScore.toFixed(1)}</span>
                <span className="text-sm">/100</span>
              </div>
              <div className="mt-2 h-1 bg-gray-200 rounded-full">
                <div
                  className="h-1 bg-warning-600 rounded-full"
                  style={{ width: `${dspPerformance.efficiencyScore}%` }}
                />
              </div>
            </div>
            
            <div className="text-center">
              <p className="text-sm text-gray-500 mb-1">Quality</p>
              <div className="flex items-center justify-center space-x-2">
                <span className="text-2xl font-bold text-info-600">{dspPerformance.qualityScore.toFixed(1)}</span>
                <span className="text-sm">/100</span>
              </div>
              <div className="mt-2 h-1 bg-gray-200 rounded-full">
                <div
                  className="h-1 bg-info-600 rounded-full"
                  style={{ width: `${dspPerformance.qualityScore}%` }}
                />
              </div>
            </div>
            
            <div className="text-center">
              <p className="text-sm text-gray-500 mb-1">Compliance</p>
              <div className="flex items-center justify-center space-x-2">
                <span className="text-2xl font-bold text-gray-900">{dspPerformance.complianceScore.toFixed(1)}</span>
                <span className="text-sm">/100</span>
              </div>
              <div className="mt-2 h-1 bg-gray-200 rounded-full">
                <div
                  className="h-1 bg-gray-600 rounded-full"
                  style={{ width: `${dspPerformance.complianceScore}%` }}
                />
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-sm text-gray-500">Drivers</p>
            <p className="text-xl font-bold text-gray-900">{dspPerformance?.driverCount || 0}</p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-500">Vans</p>
            <p className="text-xl font-bold text-gray-900">{dspPerformance?.vanCount || 0}</p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-500">Routes</p>
            <p className="text-xl font-bold text-gray-900">{dspPerformance?.routeCount || 0}</p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-500">On-Time %</p>
            <p className="text-xl font-bold text-gray-900">{Number(dspPerformance?.onTimeDeliveryRate ?? 0).toFixed(1)}%</p>
          </div>
        </div>
      </motion.div>

      {/* Team Performance */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Team Performance</h3>
          <Link
            to="/performance/teams"
            className="text-sm text-primary-600 hover:text-primary-700 hover:underline"
          >
            View All Teams
          </Link>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {teams.map((team, index) => (
            <motion.div
              key={team.teamId}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.1 }}
              className="bg-gray-50 rounded-lg p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-gray-900">{team.teamName}</h4>
                <Badge
                  variant={({
                    improving: 'success',
                    stable: 'primary',
                    declining: 'danger',
                    new: 'info',
                  } as const)[team.trend] || 'secondary'}
                >
                  {team.trend}
                </Badge>
              </div>
              <p className="text-sm text-gray-500 mb-3">{team.driverCount} drivers</p>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Overall</span>
                  <span className="font-medium text-gray-900">{team.averageOverallScore.toFixed(1)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Delivery</span>
                  <span className="font-medium text-gray-900">{team.averageDeliveryScore.toFixed(1)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Safety</span>
                  <span className="font-medium text-gray-900">{team.averageSafetyScore.toFixed(1)}</span>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-xs text-gray-500 mb-1">Top Performers</p>
                <div className="space-y-1">
                  {team.topPerformers.slice(0, 2).map((driver) => (
                    <div key={driver.driverId} className="flex items-center justify-between">
                      <span className="text-xs text-gray-600 truncate">{driver.driverName}</span>
                      <span className="text-xs font-medium text-gray-900">{Number(driver.overallScore ?? (driver as unknown as { score?: number }).score ?? 0).toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Performance Alerts */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Performance Alerts</h3>
          <Link
            to="/performance/alerts"
            className="text-sm text-primary-600 hover:text-primary-700 hover:underline"
          >
            View All Alerts
          </Link>
        </div>
        
        <div className="space-y-3">
          {alerts.map((alert, index) => (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: index * 0.1 }}
              className={clsx(
                'flex items-center justify-between p-4 rounded-lg',
                {
                  'bg-danger-50 border border-danger-200': alert.severity === 'high' || alert.severity === 'critical',
                  'bg-warning-50 border border-warning-200': alert.severity === 'medium',
                  'bg-info-50 border border-info-200': alert.severity === 'low',
                }
              )}
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-white">
                  {alert.severity === 'high' || alert.severity === 'critical' ? (
                    <AlertTriangle size={16} className="text-danger-600" />
                  ) : alert.severity === 'medium' ? (
                    <AlertTriangle size={16} className="text-warning-600" />
                  ) : (
                    <CheckCircle size={16} className="text-info-600" />
                  )}
                </div>
                <div>
                  <p className="font-medium text-gray-900">{alert.driverName}</p>
                  <p className="text-sm text-gray-600">{alert.message}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Badge
                  variant={({
                    high: 'danger',
                    critical: 'danger',
                    medium: 'warning',
                    low: 'info',
                  } as const)[alert.severity]}
                >
                  {alert.severity}
                </Badge>
                <span className="text-xs text-gray-500">
                  {new Date(alert.triggeredAt).toLocaleString()}
                </span>
                {!alert.acknowledged && (
                  <Button variant="outline" size="sm">
                    Acknowledge
                  </Button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Driver Performance Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Driver Performance</h3>
          <div className="flex items-center space-x-2">
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
        </div>

        <Table
          columns={driverColumns}
          data={sortedDrivers}
          keyExtractor={(driver) => driver.driverId}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          selectedRows={selectedRows}
          onSelectRow={handleSelectRow}
          onSelectAll={handleSelectAll}
          emptyMessage="No driver performance data found"
        />
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
              <p className="text-sm text-gray-500">Top Performers</p>
              <p className="text-xl font-bold text-gray-900">
                {drivers.filter((d) => d.grade === 'A').length}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-success-100 rounded-lg flex items-center justify-center">
              <TrendingUp size={20} className="text-success-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Avg. Score</p>
              <p className="text-xl font-bold text-gray-900">
                {drivers.length > 0 
                  ? (drivers.reduce((sum, d) => sum + d.overallScore, 0) / drivers.length).toFixed(1)
                  : '0'}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-warning-100 rounded-lg flex items-center justify-center">
              <ShieldCheck size={20} className="text-warning-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Safety Score</p>
              <p className="text-xl font-bold text-gray-900">
                {drivers.length > 0 
                  ? (drivers.reduce((sum, d) => sum + d.safetyScore, 0) / drivers.length).toFixed(1)
                  : '0'}
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default PerformancePage;
