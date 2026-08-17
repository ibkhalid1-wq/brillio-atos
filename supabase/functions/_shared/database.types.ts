/**
 * GENERATED — DO NOT HAND-EDIT.
 *
 * The public schema of the live project, as `supabase gen types typescript`
 * reads it. Refresh with:
 *
 *   npm run gen:db-types
 *
 * WHY IT EXISTS. The edge calls `createClient` with no `Database` generic, so
 * every row it reads was typed `any` — which the typecheck shim had to state
 * explicitly, because the alternative (newer supabase-js typings resolving an
 * unparameterised client's rows to `never`) turned every `row.id` in the
 * codebase into an error. `any` was the honest description of what we had. This
 * file is the upgrade: with a real schema the rows have real types, and a
 * column that gets renamed out from under the edge becomes a type error rather
 * than an `undefined` at runtime.
 *
 * IT IS A SNAPSHOT OF PRODUCTION, not of `supabase/migrations`. If the two ever
 * disagree, this file is right about what the edge will actually talk to and
 * the migrations are right about what should be there — that disagreement is
 * worth investigating rather than papering over by regenerating.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      adam_agent_events: {
        Row: {
          agent_id: string
          created_at: string
          event_type: string
          id: string
          payload: Json | null
          phase_id: string | null
          program_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          event_type: string
          id?: string
          payload?: Json | null
          phase_id?: string | null
          program_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json | null
          phase_id?: string | null
          program_id?: string
        }
        Relationships: []
      }
      adam_agent_observations: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          latency_ms: number | null
          observation_type: string
          payload: Json | null
          phase_id: string
          program_id: string
          run_id: string
          tokens: number | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          observation_type: string
          payload?: Json | null
          phase_id: string
          program_id: string
          run_id: string
          tokens?: number | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          observation_type?: string
          payload?: Json | null
          phase_id?: string
          program_id?: string
          run_id?: string
          tokens?: number | null
        }
        Relationships: []
      }
      adam_agent_runs: {
        Row: {
          agent_id: string
          awaiting_decision_id: string | null
          completed_at: string | null
          confidence: number | null
          created_at: string
          error_message: string | null
          handoff: Json | null
          id: string
          input_context: Json | null
          output: Json | null
          owner_id: string | null
          phase_id: string
          program_id: string
          reasoning_trace: string[] | null
          scheduled_by: string | null
          started_at: string | null
          status: string
          tokens_used: number | null
          trigger_event: string | null
        }
        Insert: {
          agent_id: string
          awaiting_decision_id?: string | null
          completed_at?: string | null
          confidence?: number | null
          created_at?: string
          error_message?: string | null
          handoff?: Json | null
          id?: string
          input_context?: Json | null
          output?: Json | null
          owner_id?: string | null
          phase_id: string
          program_id: string
          reasoning_trace?: string[] | null
          scheduled_by?: string | null
          started_at?: string | null
          status?: string
          tokens_used?: number | null
          trigger_event?: string | null
        }
        Update: {
          agent_id?: string
          awaiting_decision_id?: string | null
          completed_at?: string | null
          confidence?: number | null
          created_at?: string
          error_message?: string | null
          handoff?: Json | null
          id?: string
          input_context?: Json | null
          output?: Json | null
          owner_id?: string | null
          phase_id?: string
          program_id?: string
          reasoning_trace?: string[] | null
          scheduled_by?: string | null
          started_at?: string | null
          status?: string
          tokens_used?: number | null
          trigger_event?: string | null
        }
        Relationships: []
      }
      adam_agent_schedules: {
        Row: {
          agent_id: string
          created_at: string
          cron_expression: string
          enabled: boolean
          id: string
          label: string
          last_run_at: string | null
          next_run_at: string | null
          owner_id: string | null
          phase_id: string
          program_id: string
          run_count: number
        }
        Insert: {
          agent_id: string
          created_at?: string
          cron_expression: string
          enabled?: boolean
          id?: string
          label?: string
          last_run_at?: string | null
          next_run_at?: string | null
          owner_id?: string | null
          phase_id?: string
          program_id: string
          run_count?: number
        }
        Update: {
          agent_id?: string
          created_at?: string
          cron_expression?: string
          enabled?: boolean
          id?: string
          label?: string
          last_run_at?: string | null
          next_run_at?: string | null
          owner_id?: string | null
          phase_id?: string
          program_id?: string
          run_count?: number
        }
        Relationships: []
      }
      adam_ai_provider_settings: {
        Row: {
          api_key: string
          configured_by: string | null
          is_active: boolean
          model: string | null
          provider: string
          updated_at: string
        }
        Insert: {
          api_key: string
          configured_by?: string | null
          is_active?: boolean
          model?: string | null
          provider: string
          updated_at?: string
        }
        Update: {
          api_key?: string
          configured_by?: string | null
          is_active?: boolean
          model?: string | null
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      adam_audit_log: {
        Row: {
          action: string
          artifact_id: string | null
          created_at: string
          id: string
          metadata: Json | null
          phase_id: string | null
          program_id: string | null
          summary: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          artifact_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          phase_id?: string | null
          program_id?: string | null
          summary?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          artifact_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          phase_id?: string | null
          program_id?: string | null
          summary?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      adam_autonomy_log: {
        Row: {
          acted_autonomously: boolean
          action_payload: Json | null
          action_type: string
          agent_id: string
          confidence: number | null
          created_at: string
          id: string
          program_id: string
          reason: string | null
        }
        Insert: {
          acted_autonomously?: boolean
          action_payload?: Json | null
          action_type: string
          agent_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          program_id: string
          reason?: string | null
        }
        Update: {
          acted_autonomously?: boolean
          action_payload?: Json | null
          action_type?: string
          agent_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          program_id?: string
          reason?: string | null
        }
        Relationships: []
      }
      adam_autonomy_settings: {
        Row: {
          agent_id: string
          enabled: boolean | null
          id: string
          max_autonomous_actions_per_day: number | null
          program_id: string
          requires_human_above_risk: string | null
          trust_threshold: number
          updated_at: string
        }
        Insert: {
          agent_id: string
          enabled?: boolean | null
          id?: string
          max_autonomous_actions_per_day?: number | null
          program_id: string
          requires_human_above_risk?: string | null
          trust_threshold?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string
          enabled?: boolean | null
          id?: string
          max_autonomous_actions_per_day?: number | null
          program_id?: string
          requires_human_above_risk?: string | null
          trust_threshold?: number
          updated_at?: string
        }
        Relationships: []
      }
      adam_circuit_breakers: {
        Row: {
          id: string
          next_retry_at: string | null
          service: string
          state: string
          updated_at: string
        }
        Insert: {
          id?: string
          next_retry_at?: string | null
          service: string
          state?: string
          updated_at?: string
        }
        Update: {
          id?: string
          next_retry_at?: string | null
          service?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      adam_copilot_threads: {
        Row: {
          created_at: string
          id: string
          last_activity_at: string
          messages: Json
          open_questions: string[] | null
          owner_id: string | null
          program_id: string
          summary: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_activity_at?: string
          messages?: Json
          open_questions?: string[] | null
          owner_id?: string | null
          program_id: string
          summary?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_activity_at?: string
          messages?: Json
          open_questions?: string[] | null
          owner_id?: string | null
          program_id?: string
          summary?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      adam_decision_audit: {
        Row: {
          created_at: string
          decision_id: string | null
          decision_title: string | null
          id: string
          phase_id: string | null
          program_id: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          created_at?: string
          decision_id?: string | null
          decision_title?: string | null
          id?: string
          phase_id?: string | null
          program_id: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          created_at?: string
          decision_id?: string | null
          decision_title?: string | null
          id?: string
          phase_id?: string | null
          program_id?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: []
      }
      adam_document_attachments: {
        Row: {
          ai_model: string | null
          ai_provider: string | null
          confidence: number
          created_at: string
          document_type: string | null
          entities: Json | null
          extracted_data: Json
          extraction_latency_ms: number | null
          extraction_status: string
          file_name: string
          file_size_bytes: number | null
          file_type: string
          gaps_identified: string | null
          id: string
          input_tokens: number | null
          ocr_confidence: number | null
          output_tokens: number | null
          page_count: number | null
          phase_context: string | null
          program_id: string
          raw_text: string | null
          relevant_phases: string[] | null
          review_actions: Json | null
          reviewed_at: string | null
          sheet_count: number | null
          slide_count: number | null
          summary: string | null
        }
        Insert: {
          ai_model?: string | null
          ai_provider?: string | null
          confidence?: number
          created_at?: string
          document_type?: string | null
          entities?: Json | null
          extracted_data?: Json
          extraction_latency_ms?: number | null
          extraction_status?: string
          file_name: string
          file_size_bytes?: number | null
          file_type: string
          gaps_identified?: string | null
          id?: string
          input_tokens?: number | null
          ocr_confidence?: number | null
          output_tokens?: number | null
          page_count?: number | null
          phase_context?: string | null
          program_id: string
          raw_text?: string | null
          relevant_phases?: string[] | null
          review_actions?: Json | null
          reviewed_at?: string | null
          sheet_count?: number | null
          slide_count?: number | null
          summary?: string | null
        }
        Update: {
          ai_model?: string | null
          ai_provider?: string | null
          confidence?: number
          created_at?: string
          document_type?: string | null
          entities?: Json | null
          extracted_data?: Json
          extraction_latency_ms?: number | null
          extraction_status?: string
          file_name?: string
          file_size_bytes?: number | null
          file_type?: string
          gaps_identified?: string | null
          id?: string
          input_tokens?: number | null
          ocr_confidence?: number | null
          output_tokens?: number | null
          page_count?: number | null
          phase_context?: string | null
          program_id?: string
          raw_text?: string | null
          relevant_phases?: string[] | null
          review_actions?: Json | null
          reviewed_at?: string | null
          sheet_count?: number | null
          slide_count?: number | null
          summary?: string | null
        }
        Relationships: []
      }
      adam_document_entity_audit: {
        Row: {
          ai_model: string | null
          ai_provider: string | null
          approved_at: string | null
          approved_by: string | null
          attachment_id: string
          confidence: number | null
          created_at: string | null
          extraction_type: string
          field_id: string
          field_value: string
          id: string
          phase_id: string
          program_id: string
          source_text: string | null
        }
        Insert: {
          ai_model?: string | null
          ai_provider?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachment_id: string
          confidence?: number | null
          created_at?: string | null
          extraction_type: string
          field_id: string
          field_value: string
          id?: string
          phase_id: string
          program_id: string
          source_text?: string | null
        }
        Update: {
          ai_model?: string | null
          ai_provider?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachment_id?: string
          confidence?: number | null
          created_at?: string | null
          extraction_type?: string
          field_id?: string
          field_value?: string
          id?: string
          phase_id?: string
          program_id?: string
          source_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "adam_document_entity_audit_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "adam_document_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adam_document_entity_audit_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "adam_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      adam_org_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adam_org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "adam_organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      adam_organisations: {
        Row: {
          branding: Json | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          branding?: Json | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          branding?: Json | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      adam_pattern_library: {
        Row: {
          confidence: number | null
          created_at: string
          id: string
          industry: string | null
          outcome: string | null
          pattern_body: Json
          pattern_title: string
          pattern_type: string
          phase_id: string | null
          program_size: string | null
          source_program_id: string | null
          used_count: number
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          id?: string
          industry?: string | null
          outcome?: string | null
          pattern_body: Json
          pattern_title?: string
          pattern_type: string
          phase_id?: string | null
          program_size?: string | null
          source_program_id?: string | null
          used_count?: number
        }
        Update: {
          confidence?: number | null
          created_at?: string
          id?: string
          industry?: string | null
          outcome?: string | null
          pattern_body?: Json
          pattern_title?: string
          pattern_type?: string
          phase_id?: string | null
          program_size?: string | null
          source_program_id?: string | null
          used_count?: number
        }
        Relationships: []
      }
      adam_phase_agent_states: {
        Row: {
          phase_id: string
          program_id: string
          state: Json | null
          updated_at: string
        }
        Insert: {
          phase_id: string
          program_id: string
          state?: Json | null
          updated_at?: string
        }
        Update: {
          phase_id?: string
          program_id?: string
          state?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      adam_portfolio: {
        Row: {
          data: Json
          id: string
          owner_id: string | null
          updated_at: string
        }
        Insert: {
          data?: Json
          id?: string
          owner_id?: string | null
          updated_at?: string
        }
        Update: {
          data?: Json
          id?: string
          owner_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      adam_program_artifacts: {
        Row: {
          agent_id: string
          confidence: number | null
          content: Json
          generated_at: string
          id: string
          phase_id: string | null
          program_id: string
          superseded_at: string | null
          superseded_by: string | null
          version: number
        }
        Insert: {
          agent_id: string
          confidence?: number | null
          content: Json
          generated_at?: string
          id?: string
          phase_id?: string | null
          program_id: string
          superseded_at?: string | null
          superseded_by?: string | null
          version?: number
        }
        Update: {
          agent_id?: string
          confidence?: number | null
          content?: Json
          generated_at?: string
          id?: string
          phase_id?: string | null
          program_id?: string
          superseded_at?: string | null
          superseded_by?: string | null
          version?: number
        }
        Relationships: []
      }
      adam_program_events_retired_20260807: {
        Row: {
          actor_id: string | null
          actor_name: string
          agent_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json
          phase_id: string | null
          prev_snapshot: Json | null
          program_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string
          agent_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          phase_id?: string | null
          prev_snapshot?: Json | null
          program_id: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string
          agent_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          phase_id?: string | null
          prev_snapshot?: Json | null
          program_id?: string
        }
        Relationships: []
      }
      adam_program_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          program_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          program_id: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          program_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adam_program_members_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "adam_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      adam_program_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: string
          kind: string
          label: string
          program_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: Json
          id?: string
          kind?: string
          label?: string
          program_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          kind?: string
          label?: string
          program_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adam_program_snapshots_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "adam_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      adam_program_texts: {
        Row: {
          chars: number
          content: string
          field_key: string
          movement_id: string
          program_id: string
          updated_at: string
        }
        Insert: {
          chars?: number
          content?: string
          field_key: string
          movement_id?: string
          program_id: string
          updated_at?: string
        }
        Update: {
          chars?: number
          content?: string
          field_key?: string
          movement_id?: string
          program_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "adam_program_texts_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "adam_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      adam_programs: {
        Row: {
          client: string | null
          created_at: string
          data: Json
          id: string
          industry: string | null
          is_deleted: boolean
          name: string
          owner_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          client?: string | null
          created_at?: string
          data?: Json
          id?: string
          industry?: string | null
          is_deleted?: boolean
          name?: string
          owner_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          client?: string | null
          created_at?: string
          data?: Json
          id?: string
          industry?: string | null
          is_deleted?: boolean
          name?: string
          owner_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action_type: string | null
          actor: string | null
          actor_intent_mismatch: string | null
          affected_id: string | null
          affected_kind: string | null
          after_fp: string | null
          before_fp: string | null
          changed_keys: string[] | null
          id: number
          intent: Json | null
          intent_missing: boolean
          op: string
          partial: boolean | null
          program_id: string | null
          row_pk: string | null
          table_name: string
          ts: string
        }
        Insert: {
          action_type?: string | null
          actor?: string | null
          actor_intent_mismatch?: string | null
          affected_id?: string | null
          affected_kind?: string | null
          after_fp?: string | null
          before_fp?: string | null
          changed_keys?: string[] | null
          id?: never
          intent?: Json | null
          intent_missing?: boolean
          op: string
          partial?: boolean | null
          program_id?: string | null
          row_pk?: string | null
          table_name: string
          ts?: string
        }
        Update: {
          action_type?: string | null
          actor?: string | null
          actor_intent_mismatch?: string | null
          affected_id?: string | null
          affected_kind?: string | null
          after_fp?: string | null
          before_fp?: string | null
          changed_keys?: string[] | null
          id?: never
          intent?: Json | null
          intent_missing?: boolean
          op?: string
          partial?: boolean | null
          program_id?: string | null
          row_pk?: string | null
          table_name?: string
          ts?: string
        }
        Relationships: []
      }
      aura_audit_config: {
        Row: {
          enforce: boolean
          id: boolean
          note: string | null
        }
        Insert: {
          enforce?: boolean
          id?: boolean
          note?: string | null
        }
        Update: {
          enforce?: boolean
          id?: boolean
          note?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adam_can_read_program: { Args: { p_program: string }; Returns: boolean }
      adam_can_write_program: { Args: { p_program: string }; Returns: boolean }
      adam_is_program_admin: { Args: { p_program: string }; Returns: boolean }
      adam_program_role: { Args: { p_program: string }; Returns: string }
      adam_purge_program: { Args: { p_program_id: string }; Returns: boolean }
      adam_purge_program_cascade: {
        Args: { p_program_id: string }
        Returns: undefined
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
