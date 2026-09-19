import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { motion } from 'framer-motion';
import { Mail, ArrowLeft, Loader2 } from 'lucide-react';
import { Input } from '@/components/shared/Input';
import { Button } from '@/components/shared/Button';

const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { forgotPassword } = useAuth();
  const navigate = useNavigate();

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      await forgotPassword(email);
      setSuccess('Password reset link has been sent to your email.');
      setEmail('');
    } catch (err) {
      setError('Failed to send password reset link. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Validate form
  const isFormValid = email.trim() !== '';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Back button */}
      <button
        type="button"
        onClick={() => navigate('/login')}
        className="flex items-center text-sm text-gray-600 hover:text-primary-600 transition-colors"
      >
        <ArrowLeft size={16} className="mr-1" />
        Back to sign in
      </button>

      {/* Success message */}
      {success && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="p-4 bg-success-50 border border-success-200 rounded-lg"
        >
          <p className="text-success-600 text-sm">{success}</p>
        </motion.div>
      )}

      {/* Error message */}
      {error && !success && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="p-4 bg-danger-50 border border-danger-200 rounded-lg"
        >
          <p className="text-danger-600 text-sm">{error}</p>
        </motion.div>
      )}

      {/* Instructions */}
      <div className="p-4 bg-gray-50 rounded-lg">
        <p className="text-sm text-gray-600">
          Enter the email address associated with your account and we&apos;ll send you a link to reset your password.
        </p>
      </div>

      {/* Email input */}
      <Input
        type="email"
        label="Email"
        placeholder="Enter your email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        leftIcon={<Mail size={18} className="text-gray-400" />}
        required
        autoComplete="email"
        autoFocus
      />

      {/* Submit button */}
      <Button
        type="submit"
        fullWidth
        size="lg"
        isLoading={isSubmitting}
        disabled={!isFormValid || isSubmitting}
      >
        {isSubmitting ? 'Sending...' : 'Send Reset Link'}
      </Button>

      {/* Resend link */}
      {success && (
        <div className="text-center">
          <p className="text-sm text-gray-500">
            Didn&apos;t receive the email?{' '}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="text-primary-600 hover:text-primary-700 hover:underline font-medium"
            >
              Resend
            </button>
          </p>
        </div>
      )}

      {/* Sign in link */}
      <p className="text-center text-sm text-gray-600">
        Remember your password?{' '}
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="text-primary-600 hover:text-primary-700 hover:underline font-medium"
        >
          Sign in
        </button>
      </p>
    </form>
  );
};

export default ForgotPasswordPage;
