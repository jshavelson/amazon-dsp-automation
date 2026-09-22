// Authentication and authorization types

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: 'active' | 'inactive' | 'suspended';
  emailVerified: boolean;
  mfaEnabled: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
  avatar?: string;
  phone?: string;
}

export type UserRole = 
  | 'super_admin'
  | 'dsp_owner'
  | 'operations_manager'
  | 'dispatcher'
  | 'driver'
  | 'viewer';

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  isLoading: boolean;
  error: string | null;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}
export type LoginRequest = LoginCredentials;
export interface RefreshTokenRequest { refreshToken: string; }

export interface LoginResponse {
  user: User;
  token: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshTokenResponse {
  token: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  phone?: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
  confirmPassword: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface Permission {
  resource: string;
  action: string;
  allowed: boolean;
}

export interface RolePermissions {
  role: UserRole;
  permissions: Permission[];
}

export interface Tenant {
  id: string;
  name: string;
  code: string;
  status: 'active' | 'inactive' | 'suspended';
  subscriptionTier: string;
  maxUsers: number;
  currentUsers: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserTenant {
  tenantId: string;
  userId: string;
  role: UserRole;
  permissions: string[];
  isDefault: boolean;
  createdAt: string;
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (data: ResetPasswordRequest) => Promise<void>;
  refreshToken: () => Promise<void>;
  clearError: () => void;
}
