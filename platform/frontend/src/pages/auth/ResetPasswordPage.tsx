import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { motion } from 'framer-motion';
import { Lock, Eye, EyeOff, ArrowLeft, Loader2, CheckCircle } from 'lucide-react';
import { Input } from '@/components/shared/Input';
import { Button } from '@/components/shared/Button';

const ResetPasswordPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTokenValid, setIsTokenValid] = useState(true);

  const { resetPassword } = useAuth();
  const navigate = useNavigate();

  // Get token from URL
  useEffect(() => {
    const tokenParam = searchParams.get('token');
    if (tokenParam) {
      setToken(tokenParam);
    } else {
      setIsTokenValid(false);
    }
  }, [searchParams]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      setIsSubmitting(false);
      return;
    }

    // Validate password strength
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      setIsSubmitting(false);
      return;
    }

    try {
      await resetPassword({ token, password, confirmPassword });
      setSuccess('Your password has been reset successfully. You can now sign in.');
      setPassword('');
      setConfirmPassword('');
      
      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (err) {
      setError('Failed to reset password. The token may have expired.');
      setIsTokenValid(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle password visibility
  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  const toggleConfirmPasswordVisibility = () => {
    setShowConfirmPassword(!showConfirmPassword);
  };

  // Validate form
  const isFormValid = (
    password.trim() !== '' &&
    confirmPassword.trim() !== '' &&
    password === confirmPassword &&
    password.length >= 8
  );

  // Invalid token message
  if (!isTokenValid) {
    return (
      <div className="text-center space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center justify-center w-16 h-16 bg-danger-100 rounded-full mb-4"
        >
          <ArrowLeft size={24} className="text-danger-600" />
        </motion.div>
        
        <h2 className="text-xl font-semibold text-gray-900">Invalid Token</h2>
        <p className="text-gray-500">
          The password reset token is invalid or has expired. Please request a new one.
        </p>
        
        <Button
          onClick={() => navigate('/forgot-password')}
          variant="outline"
        >
          Request New Token
        </Button>
        
        <Button
          onClick={() => navigate('/login')}
          variant="ghost"
        >
          Back to Sign In
        </Button>
      </div>
    );
  }

  // Success message
  if (success) {
    return (
      <div className="text-center space-y-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="inline-flex items-center justify-center w-16 h-16 bg-success-100 rounded-full mb-4"
        >
          <CheckCircle size={24} className="text-success-600" />
        </motion.div>
        
        <h2 className="text-xl font-semibold text-gray-900">Password Reset</h2>
        <p className="text-gray-500">{success}</p>
        
        <p className="text-sm text-gray-400">
          Redirecting to sign in page...
        </p>
      </div>
    );
  }

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

      {/* Instructions */}
      <div className="p-4 bg-gray-50 rounded-lg">
        <p className="text-sm text-gray-600">
          Enter your new password below. Make sure it&apos;s at least 8 characters long.
        </p>
      </div>

      {/* Error message */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="p-4 bg-danger-50 border border-danger-200 rounded-lg"
        >
          <p className="text-danger-600 text-sm">{error}</p>
        </motion.div>
      )}

      {/* New password input */}
      <Input
        type={showPassword ? 'text' : 'password'}
        label="New Password"
        placeholder="Enter your new password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        leftIcon={<Lock size={18} className="text-gray-400" />}
        rightIcon={
          <button
            type="button"
            onClick={togglePasswordVisibility}
            className="text-gray-400 hover:text-gray-600 focus:outline-none"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        }
        required
        autoComplete="new-password"
        autoFocus
        hint={password.length > 0 && password.length < 8 ? 'Password must be at least 8 characters' : ''}
        error={password.length > 0 && password.length < 8 ? 'Password must be at least 8 characters' : ''}
      />

      {/* Confirm password input */}
      <Input
        type={showConfirmPassword ? 'text' : 'password'}
        label="Confirm Password"
        placeholder="Confirm your new password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        leftIcon={<Lock size={18} className="text-gray-400" />}
        rightIcon={
          <button
            type="button"
            onClick={toggleConfirmPasswordVisibility}
            className="text-gray-400 hover:text-gray-600 focus:outline-none"
            tabIndex={-1}
          >
            {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        }
        required
        autoComplete="new-password"
        error={confirmPassword.length > 0 && password !== confirmPassword ? 'Passwords do not match' : ''}
      />

      {/* Submit button */}
      <Button
        type="submit"
        fullWidth
        size="lg"
        isLoading={isSubmitting}
        disabled={!isFormValid || isSubmitting}
      >
        {isSubmitting ? 'Resetting...' : 'Reset Password'}
      </Button>

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

export default ResetPasswordPage;
