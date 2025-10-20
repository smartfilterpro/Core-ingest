// src/hooks/useDashboardData.ts
import { useState, useEffect } from 'react';
import { fetchDashboardData, DashboardData } from '../services/api';

interface UseDashboardDataResult {
  data: DashboardData | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export const useDashboardData = (userId: string): UseDashboardDataResult => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const dashboardData = await fetchDashboardData(userId);
      setData(dashboardData);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    // Optional: Set up polling for real-time updates
    const intervalId = setInterval(() => {
      fetchData();
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(intervalId);
  }, [userId]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
  };
};

// ============================================
// Helper function to transform API data to dashboard format
// ============================================
export const transformToDashboardFormat = (apiData: DashboardData) => {
  const { devices, deviceStatuses, dailySummaries } = apiData;

  // Transform devices to thermostat format
  const thermostats = devices.map((device, index) => {
    const status = deviceStatuses.get(device.device_key);
    const deviceSummaries = dailySummaries.filter(s => s.device_id === device.device_id);
    
    // Calculate monthly usage from daily summaries
    const monthlyUsage = calculateMonthlyUsage(deviceSummaries);
    
    // Calculate runtime today
    const today = new Date().toISOString().split('T')[0];
    const todaySummary = deviceSummaries.find(s => s.date === today);
    const runtimeToday = todaySummary ? todaySummary.runtime_seconds_total / 3600 : 0;
    
    // Calculate average daily runtime
    const avgDaily = deviceSummaries.length > 0
      ? deviceSummaries.reduce((sum, s) => sum + s.runtime_seconds_total, 0) / deviceSummaries.length / 3600
      : 0;

    return {
      id: index,
      name: device.device_name || `${device.manufacturer} Device`,
      location: device.device_name || 'Unknown Location',
      brand: device.manufacturer.toLowerCase(),
      connected: status?.is_reachable ?? device.is_reachable,
      runtimeToday: parseFloat(runtimeToday.toFixed(1)),
      avgDaily: parseFloat(avgDaily.toFixed(1)),
      operatingModes: generateOperatingModes(device.last_equipment_status),
      hvacModes: generateHVACModes(deviceSummaries),
      monthlyUsage,
    };
  });

  return thermostats;
};

// Generate operating mode distribution (you may want to calculate this from actual data)
const generateOperatingModes = (currentStatus: string) => {
  // This is a simplified version - you might want to calculate actual percentages
  // from equipment_events table
  return [
    { name: 'Active Filtration', value: 35, color: '#8bc34a' },
    { name: 'Standby', value: 28, color: '#c8e6c9' },
    { name: 'Sleep Mode', value: 20, color: '#e8f5e9' },
    { name: 'Maintenance', value: 12, color: '#fff9c4' },
    { name: 'Off', value: 5, color: '#f5f5f5' }
  ];
};

// Generate HVAC mode distribution from summaries
const generateHVACModes = (summaries: any[]) => {
  // Calculate percentages based on actual runtime data
  // This is simplified - you'd want to query equipment_events for accurate mode breakdown
  return [
    { name: 'Cooling', value: 42, color: '#42a5f5' },
    { name: 'Heating', value: 38, color: '#ef5350' },
    { name: 'Fan', value: 15, color: '#66bb6a' },
    { name: 'Aux Heat', value: 5, color: '#ff7043' }
  ];
};

// Calculate monthly usage from daily summaries
const calculateMonthlyUsage = (summaries: any[]) => {
  const monthMap = new Map<string, { cooling: number; heating: number; fan: number }>();
  
  summaries.forEach(summary => {
    const date = new Date(summary.date);
    const monthKey = date.toLocaleString('default', { month: 'short' });
    
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, { cooling: 0, heating: 0, fan: 0 });
    }
    
    const month = monthMap.get(monthKey)!;
    // This is simplified - you'd want actual mode breakdown from equipment_events
    const hours = summary.runtime_seconds_total / 3600;
    month.cooling += hours * 0.4; // Approximate split
    month.heating += hours * 0.4;
    month.fan += hours * 0.2;
  });
  
  return Array.from(monthMap.entries()).map(([month, data]) => ({
    month,
    ...data
  })).slice(-6); // Last 6 months
};
