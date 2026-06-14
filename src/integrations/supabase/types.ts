export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      adam_programs: {
        Row: {
          id: string;
          name: string;
          client: string | null;
          industry: string | null;
          owner_id: string | null;
          created_at: string;
          updated_at: string;
          data: Json;
          is_deleted: boolean;
        };
        Insert: {
          id?: string;
          name?: string;
          client?: string | null;
          industry?: string | null;
          owner_id?: string | null;
          created_at?: string;
          updated_at?: string;
          data?: Json;
          is_deleted?: boolean;
        };
        Update: {
          id?: string;
          name?: string;
          client?: string | null;
          industry?: string | null;
          owner_id?: string | null;
          created_at?: string;
          updated_at?: string;
          data?: Json;
          is_deleted?: boolean;
        };
        Relationships: [];
      };
      adam_portfolio: {
        Row: {
          id: string;
          owner_id: string | null;
          data: Json;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id?: string | null;
          data?: Json;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string | null;
          data?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      adam_audit_log: {
        Row: {
          id: string;
          program_id: string | null;
          user_id: string | null;
          action: string;
          phase_id: string | null;
          artifact_id: string | null;
          summary: string | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          program_id?: string | null;
          user_id?: string | null;
          action: string;
          phase_id?: string | null;
          artifact_id?: string | null;
          summary?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          program_id?: string | null;
          user_id?: string | null;
          action?: string;
          phase_id?: string | null;
          artifact_id?: string | null;
          summary?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      adam_agent_runs: {
        Row: {
          id: string;
          program_id: string;
          agent_id: string;
          phase_id: string;
          status: string;
          trigger_event: string | null;
          input_context: Json | null;
          output: Json | null;
          handoff: Json | null;
          reasoning_trace: string[] | null;
          confidence: number | null;
          tokens_used: number | null;
          error_message: string | null;
          awaiting_decision_id: string | null;
          scheduled_by: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          owner_id: string | null;
        };
        Insert: {
          id?: string;
          program_id: string;
          agent_id: string;
          phase_id: string;
          status?: string;
          trigger_event?: string | null;
          input_context?: Json | null;
          output?: Json | null;
          handoff?: Json | null;
          reasoning_trace?: string[] | null;
          confidence?: number | null;
          tokens_used?: number | null;
          error_message?: string | null;
          awaiting_decision_id?: string | null;
          scheduled_by?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          owner_id?: string | null;
        };
        Update: {
          id?: string;
          program_id?: string;
          agent_id?: string;
          phase_id?: string;
          status?: string;
          trigger_event?: string | null;
          input_context?: Json | null;
          output?: Json | null;
          handoff?: Json | null;
          reasoning_trace?: string[] | null;
          confidence?: number | null;
          tokens_used?: number | null;
          error_message?: string | null;
          awaiting_decision_id?: string | null;
          scheduled_by?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          owner_id?: string | null;
        };
        Relationships: [];
      };
      adam_copilot_threads: {
        Row: {
          id: string;
          program_id: string;
          workspace_id: string;
          messages: Json;
          summary: string | null;
          open_questions: string[] | null;
          last_activity_at: string;
          created_at: string;
          owner_id: string | null;
        };
        Insert: {
          id?: string;
          program_id: string;
          workspace_id: string;
          messages?: Json;
          summary?: string | null;
          open_questions?: string[] | null;
          last_activity_at?: string;
          created_at?: string;
          owner_id?: string | null;
        };
        Update: {
          id?: string;
          program_id?: string;
          workspace_id?: string;
          messages?: Json;
          summary?: string | null;
          open_questions?: string[] | null;
          last_activity_at?: string;
          created_at?: string;
          owner_id?: string | null;
        };
        Relationships: [];
      };
      adam_agent_observations: {
        Row: {
          id: string;
          run_id: string;
          program_id: string;
          agent_id: string;
          phase_id: string;
          observation_type: string;
          payload: Json | null;
          tokens: number | null;
          latency_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          run_id: string;
          program_id: string;
          agent_id: string;
          phase_id: string;
          observation_type: string;
          payload?: Json | null;
          tokens?: number | null;
          latency_ms?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          run_id?: string;
          program_id?: string;
          agent_id?: string;
          phase_id?: string;
          observation_type?: string;
          payload?: Json | null;
          tokens?: number | null;
          latency_ms?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      adam_agent_schedules: {
        Row: {
          id: string;
          program_id: string;
          agent_id: string;
          phase_id: string;
          cron_expression: string;
          label: string;
          enabled: boolean;
          last_run_at: string | null;
          next_run_at: string | null;
          run_count: number | null;
          owner_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          program_id: string;
          agent_id: string;
          phase_id: string;
          cron_expression: string;
          label: string;
          enabled?: boolean;
          last_run_at?: string | null;
          next_run_at?: string | null;
          run_count?: number | null;
          owner_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          program_id?: string;
          agent_id?: string;
          phase_id?: string;
          cron_expression?: string;
          label?: string;
          enabled?: boolean;
          last_run_at?: string | null;
          next_run_at?: string | null;
          run_count?: number | null;
          owner_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      adam_pattern_library: {
        Row: {
          id: string;
          pattern_type: string;
          phase_id: string | null;
          industry: string | null;
          program_size: string | null;
          pattern_title: string;
          pattern_body: Json;
          outcome: string | null;
          confidence: number | null;
          source_program_id: string | null;
          created_at: string;
          used_count: number | null;
        };
        Insert: {
          id?: string;
          pattern_type: string;
          phase_id?: string | null;
          industry?: string | null;
          program_size?: string | null;
          pattern_title: string;
          pattern_body: Json;
          outcome?: string | null;
          confidence?: number | null;
          source_program_id?: string | null;
          created_at?: string;
          used_count?: number | null;
        };
        Update: {
          id?: string;
          pattern_type?: string;
          phase_id?: string | null;
          industry?: string | null;
          program_size?: string | null;
          pattern_title?: string;
          pattern_body?: Json;
          outcome?: string | null;
          confidence?: number | null;
          source_program_id?: string | null;
          created_at?: string;
          used_count?: number | null;
        };
        Relationships: [];
      };
      adam_agent_events: {
        Row: {
          id: string;
          program_id: string;
          agent_id: string;
          phase_id: string | null;
          event_type: string;
          payload: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          program_id: string;
          agent_id: string;
          phase_id?: string | null;
          event_type: string;
          payload?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          program_id?: string;
          agent_id?: string;
          phase_id?: string | null;
          event_type?: string;
          payload?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      adam_program_artifacts: {
        Row: {
          id: string;
          program_id: string;
          agent_id: string;
          phase_id: string | null;
          version: number;
          content: Json;
          confidence: number | null;
          generated_at: string;
          superseded_at: string | null;
          superseded_by: string | null;
        };
        Insert: {
          id?: string;
          program_id: string;
          agent_id: string;
          phase_id?: string | null;
          version?: number;
          content: Json;
          confidence?: number | null;
          generated_at?: string;
          superseded_at?: string | null;
          superseded_by?: string | null;
        };
        Update: {
          id?: string;
          program_id?: string;
          agent_id?: string;
          phase_id?: string | null;
          version?: number;
          content?: Json;
          confidence?: number | null;
          generated_at?: string;
          superseded_at?: string | null;
          superseded_by?: string | null;
        };
        Relationships: [];
      };
      adam_autonomy_settings: {
        Row: {
          id: string;
          program_id: string;
          agent_id: string;
          trust_threshold: number;
          max_autonomous_actions_per_day: number | null;
          requires_human_above_risk: string | null;
          enabled: boolean | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          program_id: string;
          agent_id: string;
          trust_threshold?: number;
          max_autonomous_actions_per_day?: number | null;
          requires_human_above_risk?: string | null;
          enabled?: boolean | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          program_id?: string;
          agent_id?: string;
          trust_threshold?: number;
          max_autonomous_actions_per_day?: number | null;
          requires_human_above_risk?: string | null;
          enabled?: boolean | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      adam_autonomy_log: {
        Row: {
          id: string;
          program_id: string;
          agent_id: string;
          action_type: string;
          action_payload: Json | null;
          confidence: number | null;
          acted_autonomously: boolean;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          program_id: string;
          agent_id: string;
          action_type: string;
          action_payload?: Json | null;
          confidence?: number | null;
          acted_autonomously: boolean;
          reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          program_id?: string;
          agent_id?: string;
          action_type?: string;
          action_payload?: Json | null;
          confidence?: number | null;
          acted_autonomously?: boolean;
          reason?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
