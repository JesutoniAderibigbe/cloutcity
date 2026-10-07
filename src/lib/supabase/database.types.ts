
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "entitlements": {
                  Row: {
                    "created_at": string,"grant_id": string | null,"granted_at": string,"id": string,"item_id": string,"purchase_id": string | null,"revoke_reason": string | null,"revoked_at": string | null,"source": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"grant_id"?: string | null,"granted_at"?: string,"id"?: string,"item_id": string,"purchase_id"?: string | null,"revoke_reason"?: string | null,"revoked_at"?: string | null,"source": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"grant_id"?: string | null,"granted_at"?: string,"id"?: string,"item_id"?: string,"purchase_id"?: string | null,"revoke_reason"?: string | null,"revoked_at"?: string | null,"source"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "entitlements_grant_id_fkey"
      columns: ["grant_id"]
isOneToOne: false
      referencedRelation: "grants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entitlements_purchase_id_fkey"
      columns: ["purchase_id"]
isOneToOne: false
      referencedRelation: "purchases"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entitlements_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"friend_boosts": {
                  Row: {
                    "created_at": string,"grant_id": string | null,"id": number,"ny_day": string,"recipient_id": string,"sender_id": string
                  }
                  Insert: {
                    "created_at"?: string,"grant_id"?: string | null,"id"?: never,"ny_day": string,"recipient_id": string,"sender_id": string
                  }
                  Update: {
                    "created_at"?: string,"grant_id"?: string | null,"id"?: never,"ny_day"?: string,"recipient_id"?: string,"sender_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "friend_boosts_grant_id_fkey"
      columns: ["grant_id"]
isOneToOne: false
      referencedRelation: "grants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "friend_boosts_recipient_id_fkey"
      columns: ["recipient_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "friend_boosts_sender_id_fkey"
      columns: ["sender_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"friendships": {
                  Row: {
                    "addressee_id": string,"created_at": string,"id": string,"requester_id": string,"responded_at": string | null,"status": string,"updated_at": string
                  }
                  Insert: {
                    "addressee_id": string,"created_at"?: string,"id"?: string,"requester_id": string,"responded_at"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "addressee_id"?: string,"created_at"?: string,"id"?: string,"requester_id"?: string,"responded_at"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "friendships_addressee_id_fkey"
      columns: ["addressee_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "friendships_requester_id_fkey"
      columns: ["requester_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"grants": {
                  Row: {
                    "applied_at": string | null,"campaign_id": string | null,"cap_amount": number,"cash_amount": number,"clout_amount": number,"created_at": string,"eligibility": NonNullable<Json>,"id": string,"idempotency_key": string,"issued_by": string,"item_id": string | null,"kind": string,"reason": string,"user_id": string
                  }
                  Insert: {
                    "applied_at"?: string | null,"campaign_id"?: string | null,"cap_amount": number,"cash_amount"?: number,"clout_amount"?: number,"created_at"?: string,"eligibility": NonNullable<Json>,"id"?: string,"idempotency_key": string,"issued_by": string,"item_id"?: string | null,"kind": string,"reason": string,"user_id": string
                  }
                  Update: {
                    "applied_at"?: string | null,"campaign_id"?: string | null,"cap_amount"?: number,"cash_amount"?: number,"clout_amount"?: number,"created_at"?: string,"eligibility"?: NonNullable<Json>,"id"?: string,"idempotency_key"?: string,"issued_by"?: string,"item_id"?: string | null,"kind"?: string,"reason"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "grants_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"live_stats": {
                  Row: {
                    "key": string,"updated_at": string,"value": number
                  }
                  Insert: {
                    "key": string,"updated_at"?: string,"value"?: number
                  }
                  Update: {
                    "key"?: string,"updated_at"?: string,"value"?: number
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "attestation_recorded_at": string | null,"attested": boolean,"attested_at": string | null,"audio_choice": string | null,"consent_version": string | null,"consented_at": string | null,"created_at": string,"id": string,"updated_at": string
                  }
                  Insert: {
                    "attestation_recorded_at"?: string | null,"attested"?: boolean,"attested_at"?: string | null,"audio_choice"?: string | null,"consent_version"?: string | null,"consented_at"?: string | null,"created_at"?: string,"id": string,"updated_at"?: string
                  }
                  Update: {
                    "attestation_recorded_at"?: string | null,"attested"?: boolean,"attested_at"?: string | null,"audio_choice"?: string | null,"consent_version"?: string | null,"consented_at"?: string | null,"created_at"?: string,"id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"purchases": {
                  Row: {
                    "amount_cents": number,"created_at": string,"currency": string,"id": string,"item_id": string,"livemode": boolean,"paid_at": string | null,"price_tier": string,"refunded_at": string | null,"status": string,"stripe_checkout_session_id": string,"stripe_payment_intent_id": string | null,"updated_at": string,"user_id": string | null
                  }
                  Insert: {
                    "amount_cents": number,"created_at"?: string,"currency"?: string,"id"?: string,"item_id": string,"livemode"?: boolean,"paid_at"?: string | null,"price_tier": string,"refunded_at"?: string | null,"status"?: string,"stripe_checkout_session_id": string,"stripe_payment_intent_id"?: string | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"created_at"?: string,"currency"?: string,"id"?: string,"item_id"?: string,"livemode"?: boolean,"paid_at"?: string | null,"price_tier"?: string,"refunded_at"?: string | null,"status"?: string,"stripe_checkout_session_id"?: string,"stripe_payment_intent_id"?: string | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchases_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"referrals": {
                  Row: {
                    "created_at": string,"id": string,"invitee_id": string,"inviter_id": string,"qualified_at": string | null,"rewarded_at": string | null,"status": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"invitee_id": string,"inviter_id": string,"qualified_at"?: string | null,"rewarded_at"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"invitee_id"?: string,"inviter_id"?: string,"qualified_at"?: string | null,"rewarded_at"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "referrals_invitee_id_fkey"
      columns: ["invitee_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "referrals_inviter_id_fkey"
      columns: ["inviter_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"roommates": {
                  Row: {
                    "accepted_at": string | null,"created_at": string,"ended_at": string | null,"home_id": string,"id": string,"invited_by": string,"status": string,"updated_at": string,"user_high": string,"user_low": string
                  }
                  Insert: {
                    "accepted_at"?: string | null,"created_at"?: string,"ended_at"?: string | null,"home_id": string,"id"?: string,"invited_by": string,"status"?: string,"updated_at"?: string,"user_high": string,"user_low": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"created_at"?: string,"ended_at"?: string | null,"home_id"?: string,"id"?: string,"invited_by"?: string,"status"?: string,"updated_at"?: string,"user_high"?: string,"user_low"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "roommates_user_high_fkey"
      columns: ["user_high"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "roommates_user_low_fkey"
      columns: ["user_low"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"saves": {
                  Row: {
                    "client_saved_at": string | null,"created_at": string,"data": NonNullable<Json>,"flag_reason": string | null,"flagged_at": string | null,"revision": number,"save_version": number,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "client_saved_at"?: string | null,"created_at"?: string,"data": NonNullable<Json>,"flag_reason"?: string | null,"flagged_at"?: string | null,"revision"?: number,"save_version": number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "client_saved_at"?: string | null,"created_at"?: string,"data"?: NonNullable<Json>,"flag_reason"?: string | null,"flagged_at"?: string | null,"revision"?: number,"save_version"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "saves_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "assert_attested":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"attest_and_consent":
{ Args: { "p_adult": boolean,"p_attested_at": string,"p_audio_choice": string,"p_consent_version": string,"p_consented_at": string }; Returns: {
              "attestation_recorded_at": string | null,
"attested": boolean,
"attested_at": string | null,
"audio_choice": string | null,
"consent_version": string | null,
"consented_at": string | null,
"created_at": string,
"id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "profiles"
        isOneToOne: true
        isSetofReturn: false
      } },
"send_friend_boost":
{ Args: { "p_to": string }; Returns: {
              "boost_id": number,"ny_day": string
            }[]
                           },
"set_audio_choice":
{ Args: { "p_choice": string }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
