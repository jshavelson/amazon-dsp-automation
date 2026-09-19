import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, Home, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/shared/Button';

const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="text-center max-w-md w-full">
        {/* Error icon */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="inline-flex items-center justify-center w-20 h-20 bg-danger-100 rounded-full mb-6"
        >
          <AlertTriangle size={40} className="text-danger-600" />
        </motion.div>

        {/* Error code */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-6xl font-bold text-gray-900"
        >
          404
        </motion.h1>

        {/* Error message */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-4 text-xl text-gray-600"
        >
          Page Not Found
        </motion.p>

        {/* Description */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-2 text-gray-500"
        >
          The page you're looking for doesn't exist or has been moved.
        </motion.p>

        {/* Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-8 flex flex-col sm:flex-row items-center justify-center space-y-3 sm:space-y-0 sm:space-x-4"
        >
          <Button
            asChild
            variant="primary"
            leftIcon={<Home size={16} />}
          >
            <Link to="/dashboard">Go to Dashboard</Link>
          </Button>

          <Button
            asChild
            variant="outline"
            leftIcon={<ArrowLeft size={16} />}
          >
            <Link to="#" onClick={() => window.history.back()}>
              Go Back
            </Link>
          </Button>
        </motion.div>

        {/* Decorative elements */}
        <div className="mt-12 relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="absolute -left-16 top-0 w-12 h-12 bg-primary-100 rounded-full"
          />
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
            className="absolute -right-16 top-0 w-8 h-8 bg-primary-200 rounded-full"
          />
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.7 }}
            className="absolute left-1/2 -translate-x-1/2 -bottom-8 w-6 h-6 bg-primary-300 rounded-full"
          />
        </div>
      </div>
    </div>
  );
};

export default NotFoundPage;
