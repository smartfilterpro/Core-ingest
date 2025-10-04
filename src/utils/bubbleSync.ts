import axios from "axios";

export async function postToBubble(url: string, payload: any) {
  try {
    await axios.post(url, payload);
    console.log(`✅ Synced to Bubble: ${payload.device_id || payload.userId}`);
  } catch (err: any) {
    console.error(`❌ Bubble sync failed (${url}):`, err.message);
  }
}
