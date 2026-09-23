import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import {
  User,
  Mail,
  Phone,
  Calendar,
  MapPin,
  ShieldCheck,
  FileText,
  Clock,
  ArrowLeft,
  Edit,
  Trash2,
  MoreVertical,
  BarChart3,
  Activity,
  Star,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useDriver } from '@/hooks/useDrivers';
import { Driver, DriverStatus } from '@/types/driver';
import { Button, IconButton } from '@/components/shared/Button';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Badge } from '@/components/shared/Badge';

// Mock data types
interface DriverMetric {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}

interface DriverActivity {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  status: 'success' | 'warning' | 'error' | 'info';
}

interface DriverDocument {
  id: string;
  name: string;
  type: string;
  size: string;
  uploadedAt: string;
}

const DriverDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('profile');

  // Fetch driver data
  const { data: driver, isLoading, error, refetch } = useDriver(id || '', !!id);

  // Values in this view come only from connected driver records. Activity and
  // document feeds remain empty until their APIs return tenant-scoped data.
  const [metrics, setMetrics] = useState<DriverMetric[]>([]);
  const [activities, setActivities] = useState<DriverActivity[]>([]);
  const [documents, setDocuments] = useState<DriverDocument[]>([]);

  // Build display metrics from the connected driver record.
  useEffect(() => {
    if (driver) {
      // Metrics
      setMetrics([
        {
          label: 'Total Routes',
          value: driver.totalRoutes,
          icon: <Activity size={20} />,
          color: 'primary',
        },
        {
          label: 'Total Miles',
          value: driver.totalMiles.toLocaleString(),
          icon: <MapPin size={20} />,
          color: 'secondary',
        },
        {
          label: 'Total Deliveries',
          value: driver.totalDeliveries.toLocaleString(),
          icon: <FileText size={20} />,
          color: 'success',
        },
        {
          label: 'Avg. Route Completion',
          value: `${driver.averageRouteCompletion}%`,
          icon: <CheckCircle size={20} />,
          color: 'info',
        },
        {
          label: 'Performance Rating',
          value: driver.performanceRating.toFixed(1),
          icon: <Star size={20} />,
          color: 'warning',
        },
        {
          label: 'Reliability Score',
          value: driver.reliabilityScore.toFixed(1),
          icon: <ShieldCheck size={20} />,
          color: 'danger',
        },
      ]);

      setActivities([]);
      setDocuments([]);
    }
  }, [driver]);

  // Status badge variant
  const getStatusVariant = (status: DriverStatus): 'success' | 'warning' | 'danger' | 'info' | 'secondary' => {
    switch (status) {
      case 'active':
        return 'success';
      case 'on_leave':
        return 'warning';
      case 'terminated':
      case 'suspended':
        return 'danger';
      case 'pending_onboarding':
        return 'info';
      default:
        return 'secondary';
    }
  };

  // Status icon
  const getStatusIcon = (status: DriverStatus) => {
    switch (status) {
      case 'active':
        return <CheckCircle size={16} className="text-success-600" />;
      case 'on_leave':
        return <Clock size={16} className="text-warning-600" />;
      case 'terminated':
      case 'suspended':
        return <XCircle size={16} className="text-danger-600" />;
      case 'pending_onboarding':
        return <AlertTriangle size={16} className="text-info-600" />;
      default:
        return <Activity size={16} className="text-gray-400" />;
    }
  };

  // Color mapping
  const colorMap: Record<string, string> = {
    primary: 'bg-primary-50 text-primary-700',
    secondary: 'bg-secondary-50 text-secondary-700',
    success: 'bg-success-50 text-success-700',
    warning: 'bg-warning-50 text-warning-700',
    danger: 'bg-danger-50 text-danger-700',
    info: 'bg-info-50 text-info-700',
  };

  // Status color
  const statusColorMap: Record<DriverStatus, string> = {
    active: 'success',
    on_leave: 'warning',
    terminated: 'danger',
    suspended: 'danger',
    pending_onboarding: 'info',
    inactive: 'secondary',
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner size="lg" text="Loading driver details..." />
      </div>
    );
  }

  // Error state
  if (error || !driver) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <p className="text-danger-600 mb-4">Failed to load driver details</p>
          <Button onClick={() => refetch()}>Retry</Button>
        </div>
      </div>
    );
  }

  // Tabs
  const tabs = [
    { id: 'profile', label: 'Profile' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'activities', label: 'Activities' },
    { id: 'documents', label: 'Documents' },
  ];

  // Tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'metrics':
        return (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {metrics.map((metric, index) => (
              <motion.div
                key={metric.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
                className="card"
              >
                <div className="flex items-center space-x-3">
                  <div
                    className={clsx(
                      'w-10 h-10 rounded-lg flex items-center justify-center',
                      colorMap[metric.color]
                    )}
                  >
                    {metric.icon}
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">{metric.label}</p>
                    <p className="text-xl font-bold text-gray-900">{metric.value}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        );

      case 'activities':
        return (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="overflow-x-auto"
          >
            <table className="w-full text-left">
              <thead>
                <tr className="text-sm text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((activity, index) => (
                  <motion.tr
                    key={activity.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                    className="border-b border-gray-100 last:border-0"
                  >
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-gray-900 capitalize">
                        {activity.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600">{activity.description}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500">
                        {new Date(activity.timestamp).toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={activity.status as 'success' | 'warning' | 'danger' | 'info' | 'secondary'}
                      >
                        {activity.status}
                      </Badge>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        );

      case 'documents':
        return (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {documents.map((doc, index) => (
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
                className="card"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                      <FileText size={20} className="text-gray-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 truncate">{doc.name}</p>
                      <p className="text-sm text-gray-500">{doc.type}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">{doc.size}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(doc.uploadedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-end space-x-2">
                  <Button variant="ghost" size="sm">
                    Download
                  </Button>
                  <Button variant="ghost" size="sm" className="text-danger-600">
                    Delete
                  </Button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        );

      case 'profile':
      default:
        return (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Profile header */}
            <div className="flex flex-col md:flex-row items-center space-y-4 md:space-y-0 md:space-x-6">
              <div className="w-24 h-24 bg-primary-100 rounded-full flex items-center justify-center">
                <User size={48} className="text-primary-600" />
              </div>
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <h2 className="text-2xl font-bold text-gray-900">
                    {driver.firstName} {driver.lastName}
                  </h2>
                  <Badge variant={getStatusVariant(driver.status)}>
                    {getStatusIcon(driver.status)}
                    <span className="ml-1">{driver.status.replace('_', ' ')}</span>
                  </Badge>
                </div>
                <p className="text-gray-500 mt-1">{driver.employeeId}</p>
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  leftIcon={<Edit size={16} />}
                  onClick={() => navigate(`/drivers/${driver.id}/edit`)}
                >
                  Edit
                </Button>
                <IconButton
                  icon={<MoreVertical size={16} />}
                  ariaLabel="More actions"
                  variant="outline"
                />
              </div>
            </div>

            {/* Contact information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h3>
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <Mail size={16} className="text-gray-400" />
                    <span className="text-gray-900">{driver.email}</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Phone size={16} className="text-gray-400" />
                    <span className="text-gray-900">{driver.phone}</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <MapPin size={16} className="text-gray-400" />
                    <span className="text-gray-900">
                      {driver.address.street}, {driver.address.city}, {driver.address.state} {driver.address.zipCode}
                    </span>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Employment Information</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Employee ID</span>
                    <span className="font-medium text-gray-900">{driver.employeeId}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Employment Type</span>
                    <Badge variant="secondary">
                      {driver.employmentType.replace('_', ' ')}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Hire Date</span>
                    <span className="font-medium text-gray-900">
                      {new Date(driver.hireDate).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Home Station</span>
                    <span className="font-medium text-gray-900">{driver.homeStationId}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Team</span>
                    <span className="font-medium text-gray-900">{driver.teamId || 'N/A'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Mentor</span>
                    <span className="font-medium text-gray-900">{driver.mentorId || 'N/A'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* License and certification */}
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">License & Certification</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">License Number</span>
                    <span className="font-medium text-gray-900">{driver.licenseNumber}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">State</span>
                    <span className="font-medium text-gray-900">{driver.licenseState}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Expiration</span>
                    <span className="font-medium text-gray-900">
                      {new Date(driver.licenseExpiration).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Background Check</span>
                    <Badge variant={driver.backgroundCheckStatus === 'cleared' ? 'success' : 'warning'}>
                      {driver.backgroundCheckStatus.replace('_', ' ')}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Drug Test</span>
                    <Badge variant={driver.drugTestStatus === 'passed' ? 'success' : 'warning'}>
                      {driver.drugTestStatus.replace('_', ' ')}
                    </Badge>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Is Mentor</span>
                    <Badge variant={driver.isMentor ? 'success' : 'secondary'}>
                      {driver.isMentor ? 'Yes' : 'No'}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            {/* Emergency contact */}
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Emergency Contact</h3>
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <User size={16} className="text-gray-400" />
                  <span className="text-gray-900">{driver.emergencyContact.name}</span>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="text-gray-500">Relationship:</span>
                  <span className="text-gray-900">{driver.emergencyContact.relationship}</span>
                </div>
                <div className="flex items-center space-x-3">
                  <Phone size={16} className="text-gray-400" />
                  <span className="text-gray-900">{driver.emergencyContact.phone}</span>
                </div>
                {driver.emergencyContact.email && (
                  <div className="flex items-center space-x-3">
                    <Mail size={16} className="text-gray-400" />
                    <span className="text-gray-900">{driver.emergencyContact.email}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Notes */}
            {driver.notes && (
              <div className="card">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Notes</h3>
                <p className="text-gray-600">{driver.notes}</p>
              </div>
            )}
          </motion.div>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center space-x-2 text-sm text-gray-500">
        <button
          onClick={() => navigate('/drivers')}
          className="flex items-center space-x-1 hover:text-primary-600"
        >
          <ArrowLeft size={16} />
          <span>Drivers</span>
        </button>
        <span className="text-gray-400">/</span>
        <span className="text-gray-900">{driver.firstName} {driver.lastName}</span>
      </div>

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Driver Details</h1>
          <p className="text-gray-500 mt-1">View and manage driver information</p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            leftIcon={<ArrowLeft size={16} />}
            onClick={() => navigate('/drivers')}
          >
            Back
          </Button>
          <Button
            leftIcon={<Edit size={16} />}
            onClick={() => navigate(`/drivers/${driver.id}/edit`)}
          >
            Edit
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'px-4 py-2 text-sm font-medium rounded-md transition-colors',
                  {
                    'bg-white text-gray-900 shadow-sm': activeTab === tab.id,
                    'text-gray-500 hover:text-gray-700': activeTab !== tab.id,
                  }
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" leftIcon={<Trash2 size={14} />}>
              Delete
            </Button>
          </div>
        </div>

        {/* Tab content */}
        {renderTabContent()}
      </div>
    </div>
  );
};

export default DriverDetailPage;
