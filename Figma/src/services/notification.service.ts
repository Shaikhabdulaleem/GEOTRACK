import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import type { NotificationRow, TablesInsert } from '../types/database';
import { logger } from '../lib/logger';

export const notificationService = {
  async listMine(organizationId: string, userId: string): Promise<NotificationRow[]> {
    return executeQuery(
      getSupabaseClient()
        .from('notifications')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('recipient_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),
      'Unable to load notifications.',
    );
  },

  async markRead(notificationId: string): Promise<NotificationRow> {
    return executeQuery(
      getSupabaseClient()
        .rpc('mark_notification_read', { p_notification_id: notificationId })
        .single(),
      'Unable to update the notification.',
    );
  },

  // ── Dispatchers (designed for future push notification extension) ─────

  async notifyUser(input: Omit<TablesInsert<'notifications'>, 'id' | 'created_at'>): Promise<void> {
    const client = getSupabaseClient();
    // Generate the id client-side so the manager does not need SELECT access
    // to a notification addressed to another user under the notifications RLS policy.
    const notificationId = crypto.randomUUID();
    await executeQuery(
      client.from('notifications').insert({ ...input, id: notificationId } as TablesInsert<'notifications'>),
      'Failed to send user notification.'
    );

    // The edge function owns the Firebase service account. The browser only
    // sends the row id, so no FCM credential or notification body is exposed.
    const { error } = await client.functions.invoke('send-mobile-notification', {
      body: { notification_id: notificationId },
    });
    if (error) logger.warn('Mobile push dispatch failed.', { error });
  },

  async notifyManagers(
    organizationId: string,
    input: Omit<TablesInsert<'notifications'>, 'id' | 'created_at' | 'recipient_user_id' | 'organization_id'>
  ): Promise<void> {
    const client = getSupabaseClient();
    
    // Find managers in the organization
    const { data: managers } = await client
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', organizationId)
      .in('role_code', ['manager', 'administrator']);
      
    if (!managers || managers.length === 0) return;

    const inserts: TablesInsert<'notifications'>[] = managers.map(m => ({
      organization_id: organizationId,
      recipient_user_id: m.user_id,
      ...input
    } as TablesInsert<'notifications'>));

    await executeQuery(
      client.from('notifications').insert(inserts),
      'Failed to send manager notifications.'
    );
  },

  async notifyAdmins(
    organizationId: string,
    input: Omit<TablesInsert<'notifications'>, 'id' | 'created_at' | 'recipient_user_id' | 'organization_id'>
  ): Promise<void> {
    const client = getSupabaseClient();
    
    // Find admins in the organization
    const { data: admins } = await client
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('role_code', 'administrator');
      
    if (!admins || admins.length === 0) return;

    const inserts: TablesInsert<'notifications'>[] = admins.map(a => ({
      organization_id: organizationId,
      recipient_user_id: a.user_id,
      ...input
    } as TablesInsert<'notifications'>));

    await executeQuery(
      client.from('notifications').insert(inserts),
      'Failed to send admin notifications.'
    );
  }
};
