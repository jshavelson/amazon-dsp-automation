import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';

export type PlatformFeature = {
  id: string;
  displayName: string;
  route: string;
  moduleId?: string | null;
  status: 'implemented' | 'planned';
  permission: string;
  enabled: boolean;
};

export type PlatformContext = {
  tenant: { id: string; name: string };
  user: { id: string; email: string; role: string; tenantRole?: string | null; isPlatformAdmin: boolean };
  permissions: string[];
  features: PlatformFeature[];
  impersonation: null | { active: true; actorEmail: string; targetEmail: string; targetRole: string; reason: string; expiresAt: number };
};

export const usePlatformContext = () => useQuery<PlatformContext>({
  queryKey: ['platform-context'],
  queryFn: () => api.get<PlatformContext>('/context'),
  staleTime: 60_000,
});
