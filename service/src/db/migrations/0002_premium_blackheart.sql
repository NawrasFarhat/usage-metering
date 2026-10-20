CREATE TABLE "account_usage" (
	"account_id" uuid NOT NULL,
	"month" date NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "account_usage_account_id_month_pk" PRIMARY KEY("account_id","month"),
	CONSTRAINT "account_usage_used_check" CHECK ("account_usage"."used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "consume_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"units" integer NOT NULL,
	"accepted" boolean NOT NULL,
	"rejected_scope" text,
	"rejected_rule" text,
	"month" date NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consume_requests_account_request_unique" UNIQUE("account_id","request_id"),
	CONSTRAINT "consume_requests_units_check" CHECK ("consume_requests"."units" > 0)
);
--> statement-breakpoint
CREATE TABLE "user_usage" (
	"user_id" uuid NOT NULL,
	"month" date NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_usage_user_id_month_pk" PRIMARY KEY("user_id","month"),
	CONSTRAINT "user_usage_used_check" CHECK ("user_usage"."used" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account_usage" ADD CONSTRAINT "account_usage_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consume_requests" ADD CONSTRAINT "consume_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consume_requests" ADD CONSTRAINT "consume_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_usage" ADD CONSTRAINT "user_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consume_requests_account_created_idx" ON "consume_requests" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;