import { MaintenanceScreen } from '@/features/maintenance/MaintenanceScreen';

/**
 * Echow - Mode Maintenance.
 *
 * L'application est verrouillee en mode maintenance.
 * Aucun compte (nouveau ou ancien) ne peut acceder aux services,
 * les connexions et la messagerie sont temporairement suspendues.
 */
export function App() {
  return <MaintenanceScreen />;
}