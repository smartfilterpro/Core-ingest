// src/services/api.ts
import axios, { AxiosInstance } from 'axios';

// Configuration
const RAILWAY_API_URL = process.env.REACT_APP_RAILWAY_API_URL || 'https://your-railway-app.up.railway.app';
const BUBBLE_API_URL = process.env.REACT_APP_BUBBLE_API_URL || 'https://smartfilterpro-scaling.bubbleapps.io/version-test/api/1.1/wf';
const CORE_API_KEY = process.env.REACT_APP_CORE_API_KEY || '';

// Create axios instances
const railwayAPI: AxiosInstance = axios.create({
  baseURL: RAILWAY_API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'x-core-token': CORE_API_KEY, // Your JWT token or API key
  },
});

const bubbleAPI: AxiosInstance = axios.create({
  baseURL: BUBBLE_API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor for error handling
railwayAPI.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('Railway API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

bubbleAPI.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('Bubble API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// ============================================
// RAILWAY DATABASE API CALLS
// ============================================

export interface Device {
  device_key: string;
  device_id: string;
  device_name: string;
  manufacturer: string;
  model: string;
  workspace_id: string;
  last_temperature: number;
  last_humidity: number;
  last_equipment_status: string;
  is_reachable: boolean;
  updated_at: string;
}

export interface DeviceStatus {
  device_key: string;
  device_name: string;
  is_reachable: boolean;
  last_temperature: number;
  current_equipment_status: string;
  last_seen_at: string;
  last_humidity: number;
}

export interface RuntimeSession {
  session_id: string;
  device_key: string;
  mode: string;
  equipment_status: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
}

export interface DailySummary {
  device_id: string;
  date: string;
  runtime_seconds_total: number;
  runtime_sessions_count: number;
  avg_temperature: number;
}

// Get all devices for a user
export const getDevices = async (userId?: string): Promise<Device[]> => {
  const response = await railwayAPI.get('/devices', {
    params: { user_id: userId },
  });
  return response.data.devices || [];
};

// Get device status
export const getDeviceStatus = async (deviceKey: string): Promise<DeviceStatus> => {
  const response = await railwayAPI.get(`/device-status/${deviceKey}`);
  return response.data;
};

// Get runtime sessions for a device
export const getRuntimeSessions = async (
  deviceKey: string,
  startDate?: string,
  endDate?: string
): Promise<RuntimeSession[]> => {
  const response = await railwayAPI.get('/runtime-sessions', {
    params: {
      device_key: deviceKey,
      start_date: startDate,
      end_date: endDate,
    },
  });
  return response.data.sessions || [];
};

// Get daily summaries
export const getDailySummaries = async (
  deviceId: string,
  days: number = 30
): Promise<DailySummary[]> => {
  const response = await railwayAPI.get('/summaries/daily', {
    params: {
      device_id: deviceId,
      days,
    },
  });
  return response.data.summaries || [];
};

// Get equipment events (raw event data)
export const getEquipmentEvents = async (
  deviceKey: string,
  limit: number = 100
): Promise<any[]> => {
  const response = await railwayAPI.get('/equipment-events', {
    params: {
      device_key: deviceKey,
      limit,
    },
  });
  return response.data.events || [];
};

// Health check
export const checkHealth = async (): Promise<any> => {
  const response = await railwayAPI.get('/health');
  return response.data;
};

// ============================================
// BUBBLE.IO API CALLS
// ============================================

export interface BubbleUser {
  userId: string;
  email: string;
  subscription_status: string;
  filter_delivery_date: string;
}

// Get user data from Bubble
export const getBubbleUserData = async (userId: string): Promise<BubbleUser> => {
  const response = await bubbleAPI.get('/get_user_data', {
    params: { user_id: userId },
  });
  return response.data.response;
};

// Get subscription info from Bubble
export const getSubscriptionInfo = async (userId: string): Promise<any> => {
  const response = await bubbleAPI.get('/get_subscription', {
    params: { user_id: userId },
  });
  return response.data.response;
};

// Trigger filter reset (updates both Railway and Bubble)
export const triggerFilterReset = async (deviceId: string, userId: string): Promise<any> => {
  // First, update Railway
  const railwayResponse = await railwayAPI.post('/filter-reset', {
    device_id: deviceId,
    user_id: userId,
    source: 'dashboard',
  });

  // Railway will automatically sync to Bubble via the bubbleSummarySync worker
  return railwayResponse.data;
};

// ============================================
// COMBINED DATA FETCHING
// ============================================

export interface DashboardData {
  devices: Device[];
  deviceStatuses: Map<string, DeviceStatus>;
  recentSessions: RuntimeSession[];
  dailySummaries: DailySummary[];
  userData: BubbleUser | null;
}

// Fetch all data needed for dashboard
export const fetchDashboardData = async (userId: string): Promise<DashboardData> => {
  try {
    // Fetch from Railway (parallel requests)
    const [devices, userData] = await Promise.all([
      getDevices(userId),
      getBubbleUserData(userId).catch(() => null), // Bubble is optional
    ]);

    // Get device statuses for all devices
    const statusPromises = devices.map((d) =>
      getDeviceStatus(d.device_key).catch(() => null)
    );
    const statuses = await Promise.all(statusPromises);

    const deviceStatuses = new Map<string, DeviceStatus>();
    statuses.forEach((status, index) => {
      if (status) {
        deviceStatuses.set(devices[index].device_key, status);
      }
    });

    // Get recent sessions for primary device (if exists)
    let recentSessions: RuntimeSession[] = [];
    if (devices.length > 0) {
      recentSessions = await getRuntimeSessions(
        devices[0].device_key,
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // Last 7 days
        new Date().toISOString()
      ).catch(() => []);
    }

    // Get daily summaries
    let dailySummaries: DailySummary[] = [];
    if (devices.length > 0) {
      dailySummaries = await getDailySummaries(devices[0].device_id, 30).catch(() => []);
    }

    return {
      devices,
      deviceStatuses,
      recentSessions,
      dailySummaries,
      userData,
    };
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    throw error;
  }
};

export default {
  getDevices,
  getDeviceStatus,
  getRuntimeSessions,
  getDailySummaries,
  getEquipmentEvents,
  checkHealth,
  getBubbleUserData,
  getSubscriptionInfo,
  triggerFilterReset,
  fetchDashboardData,
};
