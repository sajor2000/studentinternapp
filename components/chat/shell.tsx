"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  BookOpen,
  Bot,
  Check,
  Code2,
  Copy,
  Database,
  ExternalLink,
  FileText,
  GitBranch,
  Globe2,
  History,
  LoaderCircle,
  LogOut,
  Moon,
  Paperclip,
  PanelRightOpen,
  PenSquare,
  ReceiptText,
  Search,
  Send,
  ShieldCheck,
  Square,
  Sun,
  TerminalSquare,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  assistantSkills,
  cePluginSkills,
  commandBlocks,
  compoundPluginUrl,
  modelRoutingRows,
  neonDocsUrl,
  protectedDatasetModes,
  wardArtifactFormats,
  wardSnapshotDataSources,
} from "@/app/data/student-agent-guide";
import type { SessionUser } from "@/app/lib/auth";
import { chicagoHealthMapHtmlPreviewCss } from "@/app/lib/artifact-design";

type SchemaResponse =
  | {
      ok: true;
      schema: string;
      tableCount: number;
      tables: Array<{
        tableName: string;
        rowEstimate: number;
        columns: Array<{ columnName: string; dataType: string }>;
      }>;
    }
  | {
      ok: false;
      error: string;
    };

type WardResponse =
  | {
      ok: true;
      schema: string;
      wardCount: number;
      wards: Array<{
        wardId: string;
        wardName: string | null;
        aldermanName: string | null;
        totalPopulation: number | null;
      }>;
    }
  | {
      ok: false;
      error: string;
    };

type QueryPreviewResponse =
  | {
      ok: true;
      columns: string[];
      rows: Array<Record<string, unknown>>;
      rowCount: number;
      limit: number;
      timeoutMs: number;
      durationMs: number;
    }
  | {
      ok: false;
      error: string;
    };

type DatasetRecipeRecord = {
  id: string;
  ownerUsername: string;
  title: string;
  naturalLanguageRequest: string;
  sqlText: string;
  rowGrain: string | null;
  status: "draft" | "ready" | "archived";
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
};

type DatasetRecipeListResponse =
  | {
      ok: true;
      recipes: DatasetRecipeRecord[];
    }
  | {
      ok: false;
      error: string;
    };

type SaveDatasetRecipeResponse =
  | {
      ok: true;
      recipe: DatasetRecipeRecord;
    }
  | {
      ok: false;
      error: string;
    };

type ChatSession = {
  id: string;
  ownerUsername?: string;
  title: string;
  messages: UIMessage[];
  updatedAt: number;
};

type ChatSessionListResponse =
  | {
      ok: true;
      sessions: ChatSession[];
    }
  | {
      ok: false;
      error: string;
    };

type SaveChatSessionResponse =
  | {
      ok: true;
      session?: ChatSession;
      skipped?: boolean;
    }
  | {
      ok: false;
      error: string;
    };

type WorkspaceDocRecord = {
  id: string;
  ownerUsername: string;
  projectLabel: string | null;
  docType: "brainstorm" | "plan" | "work_log" | "review" | "compound_learning" | "handoff";
  title: string;
  bodyMd: string;
  sourceCommand: string | null;
  visibility: "private" | "shared";
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
};

type WorkspaceDocListResponse =
  | {
      ok: true;
      docs: WorkspaceDocRecord[];
    }
  | {
      ok: false;
      error: string;
    };

type SaveWorkspaceDocResponse =
  | {
      ok: true;
      doc: WorkspaceDocRecord;
    }
  | {
      ok: false;
      error: string;
    };

type RenderedSegment =
  | {
      type: "text";
      value: string;
    }
  | {
      type: "code";
      language: string;
      value: string;
    };

type CodeArtifact = {
  language: string;
  value: string;
};

type ThemeMode = "light" | "dark";
type StarterLanguage = "python" | "r" | "jupyter" | "marimo";

const starterLanguageLabels: Array<{ language: StarterLanguage; label: string }> = [
  { language: "python", label: "Python" },
  { language: "r", label: "R" },
  { language: "jupyter", label: "Jupyter" },
  { language: "marimo", label: "marimo" },
];

const artifactUploadAccept = ".html,.htm,.docx,.pptx,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation";
const dataFileUploadAccept = ".csv,.xlsx,.parquet,.ipynb,.py,.r,.rmd,.qmd,text/csv,application/vnd.apache.parquet,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/x-ipynb+json,text/x-python,text/x-r-source,text/markdown";
const privateDataFileExtensions = new Set([".csv", ".xlsx", ".parquet", ".ipynb", ".py", ".r", ".rmd", ".qmd"]);

type UploadUrlResponse =
  | {
      ok: true;
      upload: {
        uploadUrl: string;
        storagePath: string;
        expiresAt: string;
        requiredHeaders: Record<string, string>;
        contentType: string;
        extension: string;
        maxBytes: number;
      };
    }
  | {
      ok: false;
      error: string;
    };

type UploadedFileReference = {
  id: string;
  uploadId?: string;
  displayLabel: string;
  extension: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  publishable?: boolean;
};

type ArtifactRecord = {
  id: string;
  ownerUsername: string;
  storagePath: string | null;
  extension: string;
  contentType: string;
  sizeBytes: number;
  artifactKind: "data_file" | "html_artifact" | "word_artifact" | "powerpoint_artifact";
  visibility: "private" | "cohort";
  status: string;
  displayName: string;
  projectLabel: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  canEdit: boolean;
};

type ArtifactListResponse =
  | {
      ok: true;
      artifacts: ArtifactRecord[];
    }
  | {
      ok: false;
      error: string;
    };

type FileListResponse =
  | {
      ok: true;
      files: ArtifactRecord[];
    }
  | {
      ok: false;
      error: string;
    };

type AdminUsageResponse =
  | {
      ok: true;
      windowDays: number;
      budgets: {
        perUserDailyUsd: number | null;
        monthlyUsd: number | null;
      };
      budgetWarnings: Array<{
        level: "warning" | "critical";
        message: string;
      }>;
      totals: {
        requestCount: number;
        totalTokens: number;
        estimatedCostUsd: number;
        monthlyEstimatedCostUsd: number;
        uploadCount: number;
        uploadBytes: number;
        chatSessionCount: number;
        queryCount: number;
        failedQueryCount: number;
        failedRequestCount: number;
      };
      users: Array<{
        username: string;
        displayName: string;
        role: "intern" | "admin";
        workflowMode: "neon" | "phi_local" | "dual";
        requestCount: number;
        failedRequestCount: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCostUsd: number;
        dailyEstimatedCostUsd: number;
        monthlyEstimatedCostUsd: number;
        lastUsedAt: string | null;
        uploadCount: number;
        uploadBytes: number;
        chatSessionCount: number;
        lastChatAt: string | null;
        queryCount: number;
        failedQueryCount: number;
        lastQueryAt: string | null;
      }>;
    }
  | {
      ok: false;
      error: string;
    };

type AdminUsageData = Extract<AdminUsageResponse, { ok: true }>;

type ArtifactUpdateResponse =
  | {
      ok: true;
      artifact: ArtifactRecord;
    }
  | {
      ok: false;
      error: string;
    };

type SaveGeneratedArtifactResponse =
  | {
      ok: true;
      artifact: ArtifactRecord;
    }
  | {
      ok: false;
      error: string;
    };

type CompleteUploadResponse =
  | {
      ok: true;
      file: ArtifactRecord;
      publishable: boolean;
    }
  | {
      ok: false;
      error: string;
    };

function createSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createEmptySession(): ChatSession {
  return {
    id: createSessionId(),
    title: "New chat",
    messages: [],
    updatedAt: Date.now(),
  };
}

function getMessageText(message: UIMessage | undefined): string {
  if (!message) {
    return "";
  }

  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSessionTitle(messages: UIMessage[]): string {
  const text = getMessageText(messages.find((message) => message.role === "user") ?? messages[0]);

  if (!text) {
    return "New chat";
  }

  return text.length > 44 ? `${text.slice(0, 44)}...` : text;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} B`;
}

function getSafeFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf(".");

  return lastDotIndex >= 0 ? fileName.slice(lastDotIndex).toLowerCase().replace(/[^a-z0-9.]+/g, "") : "";
}

function getSafeUploadName(file: File): string {
  const extension = getSafeFileExtension(file.name);

  return `upload${extension}`;
}

function isPrivateDataUploadName(fileName: string): boolean {
  return privateDataFileExtensions.has(getSafeFileExtension(fileName));
}

function formatArtifactKind(kind: ArtifactRecord["artifactKind"]): string {
  if (kind === "html_artifact") {
    return "HTML";
  }

  if (kind === "word_artifact") {
    return "Word";
  }

  if (kind === "powerpoint_artifact") {
    return "PowerPoint";
  }

  return "Data";
}

function formatPrivateFileKind(extension: string): string {
  const normalized = extension.toLowerCase();

  if (normalized === ".ipynb") {
    return "Jupyter notebook";
  }

  if (normalized === ".py") {
    return "Python code";
  }

  if (normalized === ".r") {
    return "R code";
  }

  if (normalized === ".rmd") {
    return "R Markdown";
  }

  if (normalized === ".qmd") {
    return "Quarto";
  }

  return "Data";
}

function formatArtifactDate(value: string | null): string {
  if (!value) {
    return "Draft";
  }

  return new Date(value).toLocaleDateString();
}

function formatCost(value: number): string {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

function formatWorkflowMode(mode: SessionUser["workflowMode"]): string {
  if (mode === "neon") {
    return "Neon";
  }

  if (mode === "phi_local") {
    return "PHI local";
  }

  return "Dual";
}

function formatWorkspaceDocType(type: WorkspaceDocRecord["docType"]): string {
  if (type === "compound_learning") {
    return "Compound learning";
  }

  if (type === "work_log") {
    return "Work log";
  }

  return type.replace(/_/g, " ");
}

function asStringLiteral(value: string): string {
  return JSON.stringify(value);
}

function buildRecipeStarterCode(language: StarterLanguage, sql: string, title: string): string {
  const recipeTitle = title.trim() || "Dataset recipe";
  const trimmedSql = sql.trim().replace(/;\s*$/, "");
  const sqlLiteral = asStringLiteral(trimmedSql);

  if (language === "r") {
    return [
      `# ${recipeTitle}`,
      "# Install once if needed: install.packages(c('DBI', 'RPostgres', 'readr'))",
      "library(DBI)",
      "library(RPostgres)",
      "library(readr)",
      "",
      "database_url <- Sys.getenv('READONLY_DATABASE_URL')",
      "stopifnot(nzchar(database_url))",
      "readonly_user <- sub('^postgres(?:ql)?://([^:/@]+).*$','\\\\1', database_url)",
      "readonly_user <- tolower(utils::URLdecode(readonly_user))",
      "if (!grepl('read', readonly_user) || grepl('owner|admin|loader|write', readonly_user)) stop('Set READONLY_DATABASE_URL to the approved read-only Neon role before running this starter.')",
      `sql <- ${sqlLiteral}`,
      "local_row_limit <- 50000L",
      "forbidden_sql <- '\\\\b(insert|update|delete|drop|alter|create|copy|grant|revoke|call|do|set|vacuum|analyze|truncate|merge|refresh|listen|notify|execute|prepare|deallocate|lock|into)\\\\b'",
      "require_readonly_select <- function(sql_text) {",
      "  stripped <- sub(';\\\\s*$', '', trimws(sql_text))",
      "  if (!grepl('^\\\\s*(select|with)\\\\b', stripped, ignore.case = TRUE)) stop('Recipe SQL must start with SELECT or WITH.')",
      "  if (grepl('--|/\\\\*|\\\\*/', stripped) || grepl(forbidden_sql, stripped, ignore.case = TRUE)) stop('Recipe SQL must stay read-only before local execution.')",
      "  paste0('SELECT * FROM (', stripped, ') AS recipe_query LIMIT ', local_row_limit)",
      "}",
      "safe_sql <- require_readonly_select(sql)",
      "",
      "con <- dbConnect(RPostgres::Postgres(), dbname = database_url)",
      "df <- dbGetQuery(con, safe_sql)",
      "dbDisconnect(con)",
      "",
      "print(dim(df))",
      "print(names(df))",
      "# Local-only working file. Do not publish this row-level CSV as a reviewed artifact without approval.",
      "readr::write_csv(df, 'recipe_output.csv')",
    ].join("\n");
  }

  if (language === "marimo") {
    return [
      "import marimo",
      "",
      "app = marimo.App()",
      "",
      "",
      "@app.cell",
      "def _():",
      "    import os",
      "    import pandas as pd",
      "    import re",
      "    from sqlalchemy import create_engine, text",
      "    from urllib.parse import unquote, urlparse",
      "    return create_engine, os, pd, re, text, unquote, urlparse",
      "",
      "",
      "@app.cell",
      "def _(create_engine, os, pd, re, text, unquote, urlparse):",
      `    recipe_title = ${asStringLiteral(recipeTitle)}`,
      `    sql = ${sqlLiteral}`,
      "    local_row_limit = 50000",
      "    forbidden_sql = re.compile(r\"\\b(insert|update|delete|drop|alter|create|copy|grant|revoke|call|do|set|vacuum|analyze|truncate|merge|refresh|listen|notify|execute|prepare|deallocate|lock|into)\\b\", re.IGNORECASE)",
      "    def require_readonly_select(sql_text):",
      "        stripped = sql_text.strip().rstrip(';')",
      "        if not re.match(r'^(select|with)\\b', stripped, re.IGNORECASE):",
      "            raise ValueError('Recipe SQL must start with SELECT or WITH.')",
      "        if '--' in stripped or '/*' in stripped or '*/' in stripped or forbidden_sql.search(stripped):",
      "            raise ValueError('Recipe SQL must stay read-only before local execution.')",
      "        return f'SELECT * FROM ({stripped}) AS recipe_query LIMIT {local_row_limit}'",
      "    safe_sql = require_readonly_select(sql)",
      "    database_url = os.environ['READONLY_DATABASE_URL']",
      "    database_user = unquote(urlparse(database_url).username or '').lower()",
      "    if 'read' not in database_user or any(flag in database_user for flag in ('owner', 'admin', 'loader', 'write')):",
      "        raise ValueError('Set READONLY_DATABASE_URL to the approved read-only Neon role before running this starter.')",
      "    engine = create_engine(database_url)",
      "    with engine.connect() as conn:",
      "        df = pd.read_sql_query(text(safe_sql), conn)",
      "    recipe_profile = {'rows': len(df), 'columns': list(df.columns)}",
      "    recipe_profile",
      "    return df, recipe_profile, recipe_title, sql",
      "",
      "",
      "@app.cell",
      "def _(df):",
      "    # Local-only working file. Do not publish this row-level CSV as a reviewed artifact without approval.",
      "    df.to_csv('recipe_output.csv', index=False)",
      "    return",
      "",
      "",
      "if __name__ == '__main__':",
      "    app.run()",
    ].join("\n");
  }

  if (language === "jupyter") {
    return [
      "# Cell 1: setup",
      "# Install once if needed: pip install pandas sqlalchemy psycopg2-binary",
      "import os",
      "import pandas as pd",
      "import re",
      "from sqlalchemy import create_engine, text",
      "from urllib.parse import unquote, urlparse",
      "",
      "# Cell 2: run the saved recipe",
      `recipe_title = ${asStringLiteral(recipeTitle)}`,
      `sql = ${sqlLiteral}`,
      "local_row_limit = 50000",
      "forbidden_sql = re.compile(r\"\\b(insert|update|delete|drop|alter|create|copy|grant|revoke|call|do|set|vacuum|analyze|truncate|merge|refresh|listen|notify|execute|prepare|deallocate|lock|into)\\b\", re.IGNORECASE)",
      "def require_readonly_select(sql_text):",
      "    stripped = sql_text.strip().rstrip(';')",
      "    if not re.match(r'^(select|with)\\b', stripped, re.IGNORECASE):",
      "        raise ValueError('Recipe SQL must start with SELECT or WITH.')",
      "    if '--' in stripped or '/*' in stripped or '*/' in stripped or forbidden_sql.search(stripped):",
      "        raise ValueError('Recipe SQL must stay read-only before local execution.')",
      "    return f'SELECT * FROM ({stripped}) AS recipe_query LIMIT {local_row_limit}'",
      "safe_sql = require_readonly_select(sql)",
      "database_url = os.environ['READONLY_DATABASE_URL']",
      "database_user = unquote(urlparse(database_url).username or '').lower()",
      "if 'read' not in database_user or any(flag in database_user for flag in ('owner', 'admin', 'loader', 'write')):",
      "    raise ValueError('Set READONLY_DATABASE_URL to the approved read-only Neon role before running this starter.')",
      "engine = create_engine(database_url)",
      "with engine.connect() as conn:",
      "    df = pd.read_sql_query(text(safe_sql), conn)",
      "print({'rows': len(df), 'columns': list(df.columns)})",
      "",
      "# Cell 3: write a local CSV for downstream analysis",
      "# Local-only working file. Do not publish this row-level CSV as a reviewed artifact without approval.",
      "df.to_csv('recipe_output.csv', index=False)",
    ].join("\n");
  }

  return [
    `# ${recipeTitle}`,
    "# Install once if needed: pip install pandas sqlalchemy psycopg2-binary",
    "import os",
    "import pandas as pd",
    "import re",
    "from sqlalchemy import create_engine, text",
    "from urllib.parse import unquote, urlparse",
    "",
    `SQL = ${sqlLiteral}`,
    "LOCAL_ROW_LIMIT = 50000",
    "FORBIDDEN_SQL = re.compile(r\"\\b(insert|update|delete|drop|alter|create|copy|grant|revoke|call|do|set|vacuum|analyze|truncate|merge|refresh|listen|notify|execute|prepare|deallocate|lock|into)\\b\", re.IGNORECASE)",
    "def require_readonly_select(sql_text):",
    "    stripped = sql_text.strip().rstrip(';')",
    "    if not re.match(r'^(select|with)\\b', stripped, re.IGNORECASE):",
    "        raise ValueError('Recipe SQL must start with SELECT or WITH.')",
    "    if '--' in stripped or '/*' in stripped or '*/' in stripped or FORBIDDEN_SQL.search(stripped):",
    "        raise ValueError('Recipe SQL must stay read-only before local execution.')",
    "    return f'SELECT * FROM ({stripped}) AS recipe_query LIMIT {LOCAL_ROW_LIMIT}'",
    "SAFE_SQL = require_readonly_select(SQL)",
    "DATABASE_URL = os.environ['READONLY_DATABASE_URL']",
    "DATABASE_USER = unquote(urlparse(DATABASE_URL).username or '').lower()",
    "if 'read' not in DATABASE_USER or any(flag in DATABASE_USER for flag in ('owner', 'admin', 'loader', 'write')):",
    "    raise ValueError('Set READONLY_DATABASE_URL to the approved read-only Neon role before running this starter.')",
    "",
    "engine = create_engine(DATABASE_URL)",
    "with engine.connect() as conn:",
    "    df = pd.read_sql_query(text(SAFE_SQL), conn)",
    "",
    "print({'rows': len(df), 'columns': list(df.columns)})",
    "# Local-only working file. Do not publish this row-level CSV as a reviewed artifact without approval.",
    "df.to_csv('recipe_output.csv', index=False)",
  ].join("\n");
}

function buildFileReaderSnippet(extension: string, pathVariable: string): string {
  const normalized = extension.toLowerCase();

  if (normalized === ".xlsx" || normalized === ".xls") {
    return `pd.read_excel(${pathVariable})`;
  }

  if (normalized === ".parquet") {
    return `pd.read_parquet(${pathVariable})`;
  }

  if (normalized === ".html" || normalized === ".htm") {
    return `pd.read_html(${pathVariable})[0]`;
  }

  return `pd.read_csv(${pathVariable})`;
}

function buildRFileReaderSnippet(extension: string, pathVariable: string): string {
  const normalized = extension.toLowerCase();

  if (normalized === ".xlsx" || normalized === ".xls") {
    return `readxl::read_excel(${pathVariable})`;
  }

  if (normalized === ".parquet") {
    return `arrow::read_parquet(${pathVariable})`;
  }

  if (normalized === ".html" || normalized === ".htm") {
    return `rvest::html_table(rvest::read_html(${pathVariable}))[[1]]`;
  }

  return `readr::read_csv(${pathVariable}, show_col_types = FALSE)`;
}

function isNotebookOrSourceExtension(extension: string): boolean {
  return [".ipynb", ".py", ".r", ".rmd", ".qmd"].includes(extension.toLowerCase());
}

function indentCodeLines(lines: string[], spaces: number): string[] {
  const prefix = " ".repeat(spaces);

  return lines.map((line) => (line.length > 0 ? `${prefix}${line}` : line));
}

function buildPythonLocalSummaryLines(): string[] {
  return [
    "aggregate_tables = []  # Add privacy-reviewed aggregate DataFrames; never row-level extracts.",
    "html_sections = [",
    "    \"<!doctype html><html><head><meta charset='utf-8'><title>Local analysis summary</title></head><body>\",",
    "    \"<h1>Local analysis summary</h1>\",",
    "    \"<p>Source file path is retained locally outside this artifact.</p>\",",
    "    f\"<p>Rows after identifier removal: {len(analysis_df)}</p>\",",
    "    f\"<p>Columns after identifier removal: {len(analysis_df.columns)}</p>\",",
    "    \"<p>Add only privacy-reviewed aggregate tables after small-cell suppression. Do not add row-level extracts.</p>\",",
    "]",
    "for index, table in enumerate(aggregate_tables, start=1):",
    "    safe_table = suppress_small_cells(table) if 'n' in table.columns else table",
    "    html_sections.append(f\"<h2>Aggregate table {index}</h2>\")",
    "    html_sections.append(safe_table.to_html(index=False))",
    "html_sections.append(\"</body></html>\")",
    "with open('local_analysis_summary.html', 'w', encoding='utf-8') as handle:",
    "    handle.write('\\n'.join(html_sections))",
  ];
}

function buildRLocalSummaryLines(): string[] {
  return [
    "html_escape <- function(value) {",
    "  value <- gsub('&', '&amp;', as.character(value), fixed = TRUE)",
    "  value <- gsub('<', '&lt;', value, fixed = TRUE)",
    "  value <- gsub('>', '&gt;', value, fixed = TRUE)",
    "  value",
    "}",
    "aggregate_tables <- list()  # Add privacy-reviewed aggregate data frames; never row-level extracts.",
    "data_frame_to_html <- function(data) {",
    "  if (nrow(data) == 0 || ncol(data) == 0) return('<p>No aggregate rows.</p>')",
    "  header <- paste0('<tr>', paste0('<th>', html_escape(names(data)), '</th>', collapse = ''), '</tr>')",
    "  rows <- apply(data, 1, function(row) paste0('<tr>', paste0('<td>', html_escape(row), '</td>', collapse = ''), '</tr>'))",
    "  paste0('<table>', header, paste(rows, collapse = ''), '</table>')",
    "}",
    "html_sections <- c(",
    "  \"<!doctype html><html><head><meta charset='utf-8'><title>Local analysis summary</title></head><body>\",",
    "  \"<h1>Local analysis summary</h1>\",",
    "  '<p>Source file path is retained locally outside this artifact.</p>',",
    "  paste0('<p>Rows after identifier removal: ', nrow(analysis_df), '</p>'),",
    "  paste0('<p>Columns after identifier removal: ', ncol(analysis_df), '</p>'),",
    "  '<p>Add only privacy-reviewed aggregate tables after small-cell suppression. Do not add row-level extracts.</p>'",
    ")",
    "for (index in seq_along(aggregate_tables)) {",
    "  table <- aggregate_tables[[index]]",
    "  safe_table <- if ('n' %in% names(table)) suppress_small_cells(table) else table",
    "  html_sections <- c(html_sections, paste0('<h2>Aggregate table ', index, '</h2>'), data_frame_to_html(safe_table))",
    "}",
    "html_sections <- c(html_sections, '</body></html>')",
    "writeLines(html_sections, 'local_analysis_summary.html')",
  ];
}

function buildUploadedSourceStarterCode(language: StarterLanguage, displayName: string, filePath: string, extension: string): string {
  const normalizedExtension = extension.toLowerCase();

  if (language === "r") {
    return [
      `# Local source/notebook review starter for ${displayName}`,
      "# Use this for uploaded notebook/code records. Select a CSV, XLSX, or Parquet private file record for tabular PHI analysis.",
      `local_path <- ${asStringLiteral(filePath)}`,
      `file_extension <- ${asStringLiteral(normalizedExtension)}`,
      "stopifnot(file.exists(local_path))",
      "source_lines <- readLines(local_path, warn = FALSE, encoding = 'UTF-8')",
      "source_profile <- list(extension = file_extension, line_count = length(source_lines))",
      "print(source_profile)",
      "",
      "# Do not print source_lines or paste full source into chat; code can contain PHI, credentials, paths, or private project details.",
      "# Locally review the code for hard-coded identifiers, credentials, row-level outputs, and unsafe writes before adapting it.",
      "# Copy only the minimum necessary safe snippets into a new approved local/Rush script or notebook.",
      "# Keep shared outputs aggregate-only, apply minimum-cell-size suppression, and do not publish row-level extracts.",
    ].join("\n");
  }

  const pythonProfileLines = [
    `# Local source/notebook review starter for ${displayName}`,
    "# Use this for uploaded notebook/code records. Select a CSV, XLSX, or Parquet private file record for tabular PHI analysis.",
    "from pathlib import Path",
    "import json",
    "",
    `local_path = Path(${asStringLiteral(filePath)})`,
    `file_extension = ${asStringLiteral(normalizedExtension)}`,
    "assert local_path.exists(), f'Missing local file: {local_path}'",
    "",
    "if file_extension == '.ipynb':",
    "    notebook = json.loads(local_path.read_text(encoding='utf-8'))",
    "    cells = notebook.get('cells', [])",
    "    profile = {",
    "        'extension': file_extension,",
    "        'cells': len(cells),",
    "        'code_cells': sum(1 for cell in cells if cell.get('cell_type') == 'code'),",
    "        'markdown_cells': sum(1 for cell in cells if cell.get('cell_type') == 'markdown'),",
    "    }",
    "else:",
    "    source_lines = local_path.read_text(encoding='utf-8').splitlines()",
    "    profile = {'extension': file_extension, 'line_count': len(source_lines)}",
    "",
    "print(profile)",
    "",
    "# Do not print notebook/source contents or paste full source into chat; code can contain PHI, credentials, paths, or private project details.",
    "# Locally review the code for hard-coded identifiers, credentials, row-level outputs, and unsafe writes before adapting it.",
    "# Copy only the minimum necessary safe snippets into a new approved local/Rush script or notebook.",
    "# Keep shared outputs aggregate-only, apply minimum-cell-size suppression, and do not publish row-level extracts.",
  ];

  if (language === "jupyter") {
    return [
      "# Cell 1: profile local uploaded notebook/source file without printing contents",
      ...pythonProfileLines,
      "",
      "# Cell 2: adapt reviewed snippets locally",
      "# Add imports, data-reader code, identifier removal, aggregation, and output cells here after reviewing the source file.",
    ].join("\n");
  }

  if (language === "marimo") {
    return [
      "import marimo",
      "",
      "app = marimo.App()",
      "",
      "",
      "@app.cell",
      "def _():",
      "    from pathlib import Path",
      "    import json",
      "    return Path, json",
      "",
      "",
      "@app.cell",
      "def _(Path, json):",
      `    local_path = Path(${asStringLiteral(filePath)})`,
      `    file_extension = ${asStringLiteral(normalizedExtension)}`,
      "    assert local_path.exists(), f'Missing local file: {local_path}'",
      "    if file_extension == '.ipynb':",
      "        notebook = json.loads(local_path.read_text(encoding='utf-8'))",
      "        cells = notebook.get('cells', [])",
      "        profile = {",
      "            'extension': file_extension,",
      "            'cells': len(cells),",
      "            'code_cells': sum(1 for cell in cells if cell.get('cell_type') == 'code'),",
      "            'markdown_cells': sum(1 for cell in cells if cell.get('cell_type') == 'markdown'),",
      "        }",
      "    else:",
      "        source_lines = local_path.read_text(encoding='utf-8').splitlines()",
      "        profile = {'extension': file_extension, 'line_count': len(source_lines)}",
      "    profile",
      "    return profile,",
      "",
      "",
      "@app.cell",
      "def _(profile):",
      "    # Do not print notebook/source contents or paste full source into chat.",
      "    # Copy only minimum necessary safe snippets into new approved local/Rush cells after review.",
      "    # Select a CSV, XLSX, or Parquet private file record for tabular PHI analysis.",
      "    profile",
      "",
      "",
      "if __name__ == '__main__':",
      "    app.run()",
    ].join("\n");
  }

  return pythonProfileLines.join("\n");
}

function buildUploadedFileStarterCode(language: StarterLanguage, file: ArtifactRecord | null): string {
  const displayName = file?.displayName ?? "uploaded_data_file";
  const extension = file?.extension ?? ".csv";
  const normalizedExtension = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  const baseName = displayName
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "uploaded_data_file";
  const fileName = baseName.toLowerCase().endsWith(normalizedExtension) ? baseName : `${baseName}${normalizedExtension}`;
  const filePath = `./${fileName}`;
  const pythonReader = buildFileReaderSnippet(extension, "local_path");
  const rReader = buildRFileReaderSnippet(extension, "local_path");

  if (isNotebookOrSourceExtension(normalizedExtension)) {
    return buildUploadedSourceStarterCode(language, displayName, filePath, normalizedExtension);
  }

  if (language === "r") {
    return [
      `# Local PHI-scrubbed starter for ${displayName}`,
      "# Install once if needed: install.packages(c('readr', 'readxl', 'arrow', 'dplyr', 'rvest'))",
      "library(dplyr)",
      "library(readr)",
      "library(readxl)",
      "library(arrow)",
      "library(rvest)",
      "",
      `local_path <- ${asStringLiteral(filePath)}`,
      `df <- ${rReader}`,
      "",
      "expected_columns <- c()  # Fill in required column names before running.",
      "missing_columns <- setdiff(expected_columns, names(df))",
      "stopifnot(length(missing_columns) == 0)",
      "",
      "direct_identifier_candidates <- c(",
      "  'name', 'first_name', 'last_name', 'full_name', 'patient_name', 'member_name',",
      "  'mrn', 'medical_record_number', 'patient_id', 'member_id', 'subscriber_id',",
      "  'account_number', 'dob', 'date_of_birth', 'address', 'street_address',",
      "  'phone', 'phone_number', 'email', 'email_address', 'ssn', 'social_security_number'",
      ")",
      "normalize_column_name <- function(value) {",
      "  gsub('^_+|_+$', '', gsub('_+', '_', gsub('[^a-z0-9]+', '_', tolower(trimws(value)))))",
      "}",
      "normalized_column_names <- vapply(names(df), normalize_column_name, character(1))",
      "direct_identifier_columns <- names(df)[normalized_column_names %in% direct_identifier_candidates]",
      "# Review this list before analysis; add project-specific identifier columns if needed.",
      "analysis_df <- df %>% select(-any_of(direct_identifier_columns))",
      "",
      "minimum_cell_size <- 11",
      "suppress_small_cells <- function(data, count_col = 'n') {",
      "  data %>% mutate(across(all_of(count_col), ~ ifelse(.x < minimum_cell_size, NA_integer_, .x)))",
      "}",
      "",
      "print(dim(analysis_df))",
      "print(names(analysis_df))",
      "# Local-only working file. Do not upload or publish this row-level CSV as a reviewed artifact.",
      "readr::write_csv(analysis_df, 'local_analysis_output.csv')",
      "",
      ...buildRLocalSummaryLines(),
    ].join("\n");
  }

  if (language === "marimo") {
    return [
      "import marimo",
      "",
      "app = marimo.App()",
      "",
      "",
      "@app.cell",
      "def _():",
      "    import html",
      "    import pandas as pd",
      "    import re",
      "    return html, pd, re",
      "",
      "",
      "@app.cell",
      "def _(pd, re):",
      `    local_path = ${asStringLiteral(filePath)}`,
      `    df = ${pythonReader}`,
      "    expected_columns = []  # Fill in required column names before running.",
      "    missing_columns = sorted(set(expected_columns) - set(df.columns))",
      "    assert not missing_columns, f'Missing columns: {missing_columns}'",
      "    direct_identifier_candidates = {",
      "        'name', 'first_name', 'last_name', 'full_name', 'patient_name', 'member_name',",
      "        'mrn', 'medical_record_number', 'patient_id', 'member_id', 'subscriber_id',",
      "        'account_number', 'dob', 'date_of_birth', 'address', 'street_address',",
      "        'phone', 'phone_number', 'email', 'email_address', 'ssn', 'social_security_number',",
      "    }",
      "    def normalize_column_name(value):",
      "        return re.sub(r'_+', '_', re.sub(r'[^a-z0-9]+', '_', str(value).strip().lower())).strip('_')",
      "    direct_identifier_columns = [",
      "        column for column in df.columns",
      "        if normalize_column_name(column) in direct_identifier_candidates",
      "    ]",
      "    # Review this list before analysis; add project-specific identifier columns if needed.",
      "    analysis_df = df.drop(columns=direct_identifier_columns, errors='ignore')",
      "    analysis_profile = {'rows': len(analysis_df), 'columns': list(analysis_df.columns)}",
      "    analysis_profile",
      "    return analysis_df, analysis_profile",
      "",
      "",
      "@app.cell",
      "def _(analysis_df, html, pd):",
      "    minimum_cell_size = 11",
      "    def suppress_small_cells(frame, count_col='n'):",
      "        out = frame.copy()",
      "        if count_col in out.columns:",
      "            out.loc[out[count_col] < minimum_cell_size, count_col] = pd.NA",
      "        return out",
      "    # Local-only working file. Do not upload or publish this row-level CSV as a reviewed artifact.",
      "    analysis_df.to_csv('local_analysis_output.csv', index=False)",
      "",
      ...indentCodeLines(buildPythonLocalSummaryLines(), 4),
      "    return minimum_cell_size,",
      "",
      "",
      "if __name__ == '__main__':",
      "    app.run()",
    ].join("\n");
  }

  const pythonSetupLines = [
    "# Install once if needed: pip install pandas openpyxl pyarrow lxml html5lib",
    "import html",
    "import pandas as pd",
    "import re",
    "",
    `local_path = ${asStringLiteral(filePath)}`,
    `df = ${pythonReader}`,
    "",
    "expected_columns = []  # Fill in required column names before running.",
    "missing_columns = sorted(set(expected_columns) - set(df.columns))",
    "assert not missing_columns, f'Missing columns: {missing_columns}'",
  ];

  const pythonIdentifierLines = [
    "direct_identifier_candidates = {",
    "    'name', 'first_name', 'last_name', 'full_name', 'patient_name', 'member_name',",
    "    'mrn', 'medical_record_number', 'patient_id', 'member_id', 'subscriber_id',",
    "    'account_number', 'dob', 'date_of_birth', 'address', 'street_address',",
    "    'phone', 'phone_number', 'email', 'email_address', 'ssn', 'social_security_number',",
    "}",
    "def normalize_column_name(value):",
    "    return re.sub(r'_+', '_', re.sub(r'[^a-z0-9]+', '_', str(value).strip().lower())).strip('_')",
    "direct_identifier_columns = [",
    "    column for column in df.columns",
    "    if normalize_column_name(column) in direct_identifier_candidates",
    "]",
    "# Review this list before analysis; add project-specific identifier columns if needed.",
    "analysis_df = df.drop(columns=direct_identifier_columns, errors='ignore')",
  ];

  const pythonSuppressionLines = [
    "minimum_cell_size = 11",
    "def suppress_small_cells(frame, count_col='n'):",
    "    out = frame.copy()",
    "    if count_col in out.columns:",
    "        out.loc[out[count_col] < minimum_cell_size, count_col] = pd.NA",
    "    return out",
  ];

  const pythonOutputLines = [
    "print({'rows': len(analysis_df), 'columns': list(analysis_df.columns)})",
    "# Local-only working file. Do not upload or publish this row-level CSV as a reviewed artifact.",
    "analysis_df.to_csv('local_analysis_output.csv', index=False)",
    "",
    ...buildPythonLocalSummaryLines(),
  ];

  const pythonLines = [
    `# Local PHI-scrubbed starter for ${displayName}`,
    ...pythonSetupLines,
    "",
    ...pythonIdentifierLines,
    "",
    ...pythonSuppressionLines,
    "",
    ...pythonOutputLines,
  ];

  if (language === "jupyter") {
    return [
      "# Cell 1: setup and read local file",
      ...pythonSetupLines,
      "",
      "# Cell 2: remove direct identifiers before analysis",
      ...pythonIdentifierLines,
      "",
      "# Cell 3: suppress small cells in shared aggregate outputs",
      ...pythonSuppressionLines,
      "",
      "# Cell 4: write local-only CSV and aggregate-safe HTML summary",
      ...pythonOutputLines,
    ].join("\n");
  }

  return pythonLines.join("\n");
}

function buildUploadedFileContext(files: UploadedFileReference[]): string {
  if (files.length === 0) {
    return "";
  }

  return [
    "Approved portal private file record references for this request:",
    ...files.map(
      (file, index) => {
        const recordLabel = file.uploadId ? `private file record ${file.uploadId}` : "private file record pending";

        return `- File ${index + 1}: ${file.extension}, ${file.contentType}, ${formatFileSize(file.sizeBytes)}, ${recordLabel}.`;
      },
    ),
    "Do not assume file contents are available in the model context. Use these references to coach the intern on safe code, schema inspection, local or approved-environment analysis, and minimum-necessary PHI handling.",
  ].join("\n");
}

function parseRenderedSegments(text: string): RenderedSegment[] {
  const segments: RenderedSegment[] = [];
  const codeBlockPattern = /```(\w+)?\n([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, match.index) });
    }

    segments.push({
      type: "code",
      language: match[1] ?? "text",
      value: match[2].trim(),
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}

function findLatestHtmlArtifact(messages: ReturnType<typeof useChat>["messages"]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") {
      continue;
    }

    const text = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("\n");
    const match = text.match(/```\s*html[^\n]*\n([\s\S]*?)```/i);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function findLatestCodeArtifact(messages: ReturnType<typeof useChat>["messages"]): CodeArtifact | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") {
      continue;
    }

    const text = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("\n");
    const codeBlockPattern = /```\s*(\w+)?[^\n]*\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    let latest: CodeArtifact | null = null;

    while ((match = codeBlockPattern.exec(text)) !== null) {
      const language = match[1]?.toLowerCase() ?? "text";

      if (language !== "html" && match[2]?.trim()) {
        latest = {
          language,
          value: match[2].trim(),
        };
      }
    }

    if (latest) {
      return latest;
    }
  }

  return null;
}

function applyChicagoHealthMapPreviewDesign(html: string): string {
  const styleTag = `<style data-chicago-health-map-preview>${chicagoHealthMapHtmlPreviewCss}</style>`;

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${styleTag}`);
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${styleTag}</head>`);
  }

  return `<!doctype html><html><head><meta charset="utf-8">${styleTag}</head><body>${html}</body></html>`;
}

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
        }

        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
        }

        return <span key={`${part}-${index}`}>{part.replace(/\*\*/g, "")}</span>;
      })}
    </>
  );
}

function FormattedText({ text }: { text: string }) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const elements: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];

      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
      }

      elements.push(
        <ul className="vc-message-list" key={`list-${index}`}>
          {items.map((item) => (
            <li key={item}>
              <InlineText text={item} />
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^#{1,3}\s+/.test(line)) {
      elements.push(
        <h3 className="vc-message-heading" key={`heading-${index}`}>
          <InlineText text={line.replace(/^#{1,3}\s+/, "")} />
        </h3>,
      );
      index += 1;
      continue;
    }

    elements.push(
      <p key={`text-${index}`}>
        <InlineText text={line} />
      </p>,
    );
    index += 1;
  }

  return <>{elements}</>;
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="vc-code-block">
      <div className="vc-code-header">
        <span>{language}</span>
        <button type="button" onClick={copyCode}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{value}</code>
      </pre>
    </div>
  );
}

function MessageText({ text }: { text: string }) {
  return (
    <>
      {parseRenderedSegments(text).map((segment, index) =>
        segment.type === "code" ? (
          <CodeBlock key={`code-${index}-${segment.language}`} language={segment.language} value={segment.value} />
        ) : (
          <FormattedText key={`text-${index}`} text={segment.value} />
        ),
      )}
    </>
  );
}

function getChatErrorMessage(error: Error | undefined): string {
  if (!error?.message) {
    return "The assistant is not ready. Check model and database environment variables, then try again.";
  }

  try {
    const parsed = JSON.parse(error.message) as { error?: unknown };

    if (typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // Keep unexpected server details out of the UI.
  }

  return "The assistant is not ready. Check model and database environment variables, then try again.";
}

function buildWorkspaceDocBody(messages: UIMessage[]): string {
  const lines = messages
    .map((message) => {
      const text = getMessageText(message);

      if (!text) {
        return null;
      }

      return `## ${message.role === "user" ? "Intern" : "Assistant"}\n\n${text}`;
    })
    .filter(Boolean);

  return lines.length > 0
    ? lines.join("\n\n")
    : "No chat content was available. Add notes here after starting a CE workflow.";
}

export function ChatShell({ session }: { session: SessionUser }) {
  const [input, setInput] = useState("");
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [wardIndex, setWardIndex] = useState<WardResponse | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => createSessionId());
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [rightTab, setRightTab] = useState<"artifact" | "code" | "neon" | "plugin" | "workspace" | "admin">("artifact");
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileReference[]>([]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [artifactsLoaded, setArtifactsLoaded] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [fileRecords, setFileRecords] = useState<ArtifactRecord[]>([]);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [adminUsage, setAdminUsage] = useState<AdminUsageData | null>(null);
  const [adminUsageLoaded, setAdminUsageLoaded] = useState(false);
  const [adminUsageError, setAdminUsageError] = useState<string | null>(null);
  const [previewSql, setPreviewSql] = useState("select ward_id, ward_name, alderman_name, total_population from dim_aldermanic_wards order by ward_id::int");
  const [queryPreview, setQueryPreview] = useState<Extract<QueryPreviewResponse, { ok: true }> | null>(null);
  const [queryPreviewError, setQueryPreviewError] = useState<string | null>(null);
  const [isPreviewingQuery, setIsPreviewingQuery] = useState(false);
  const [schemaSearch, setSchemaSearch] = useState("");
  const [selectedSchemaTableName, setSelectedSchemaTableName] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<DatasetRecipeRecord[]>([]);
  const [recipesLoaded, setRecipesLoaded] = useState(false);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const [workspaceDocs, setWorkspaceDocs] = useState<WorkspaceDocRecord[]>([]);
  const [workspaceDocsLoaded, setWorkspaceDocsLoaded] = useState(false);
  const [workspaceDocError, setWorkspaceDocError] = useState<string | null>(null);
  const [savingWorkspaceDoc, setSavingWorkspaceDoc] = useState<"work_log" | "compound_learning" | null>(null);
  const [recipeTitle, setRecipeTitle] = useState("Ward population starter");
  const [recipeRequest, setRecipeRequest] = useState("Create a ward-level dataset with ward id, ward name, alderman, and population.");
  const [recipeRowGrain, setRecipeRowGrain] = useState("One row per aldermanic ward");
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [starterLanguage, setStarterLanguage] = useState<StarterLanguage>("python");
  const [publishingArtifactId, setPublishingArtifactId] = useState<string | null>(null);
  const [isSavingGeneratedArtifact, setIsSavingGeneratedArtifact] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [selectedPrivateFileId, setSelectedPrivateFileId] = useState<string | null>(null);
  const [fileStarterLanguage, setFileStarterLanguage] = useState<StarterLanguage>("python");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const neonWorkflowEnabled = session.role === "admin" || session.workflowMode === "neon" || session.workflowMode === "dual";
  const phiLocalWorkflowEnabled = session.role === "admin" || session.workflowMode === "phi_local" || session.workflowMode === "dual";
  const uploadAccept = phiLocalWorkflowEnabled ? `${dataFileUploadAccept},${artifactUploadAccept}` : artifactUploadAccept;
  const promptSafetyText = phiLocalWorkflowEnabled
    ? "Use minimum necessary PHI only when needed for correct code. Do not paste names, MRNs, DOBs, contact info, credentials, re-identification keys, or full row extracts; prefer schema, masked examples, and private file record IDs."
    : "Use de-identified HealthMap/Neon context only. Do not paste PHI, credentials, re-identification keys, or row-level extracts into chat.";

  const { messages, setMessages, sendMessage, status, stop, error, clearError, regenerate } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });

  const isBusy = status === "submitted" || status === "streaming";
  const activeChatTitle = useMemo(() => getSessionTitle(messages), [messages]);
  const latestHtmlArtifact = useMemo(() => findLatestHtmlArtifact(messages), [messages]);
  const latestCodeArtifact = useMemo(() => findLatestCodeArtifact(messages), [messages]);
  const previewHtmlArtifact = useMemo(
    () => (latestHtmlArtifact ? applyChicagoHealthMapPreviewDesign(latestHtmlArtifact) : null),
    [latestHtmlArtifact],
  );
  const nextThemeMode = themeMode === "dark" ? "light" : "dark";
  const visibleArtifacts = useMemo(() => artifacts.slice(0, 8), [artifacts]);
  const visiblePrivateFiles = useMemo(
    () => fileRecords.filter((file) => file.artifactKind === "data_file").slice(0, 8),
    [fileRecords],
  );
  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null,
    [artifacts, selectedArtifactId],
  );
  const selectedArtifactUrl = selectedArtifact ? `/api/artifacts/open?id=${encodeURIComponent(selectedArtifact.id)}` : null;
  const selectedArtifactIsHtml = selectedArtifact?.extension === ".html" || selectedArtifact?.extension === ".htm";
  const selectedPrivateFile = useMemo(
    () =>
      visiblePrivateFiles.find((file) => file.id === selectedPrivateFileId) ??
      visiblePrivateFiles[0] ??
      null,
    [selectedPrivateFileId, visiblePrivateFiles],
  );
  const hasArtifactPanelContent = Boolean(latestHtmlArtifact || visibleArtifacts.length > 0 || visiblePrivateFiles.length > 0);

  const filteredChatSessions = useMemo(() => {
    const search = sessionSearch.trim().toLowerCase();
    const sessions = chatSessions.filter((chatSession) => chatSession.messages.length > 0);

    if (!search) {
      return sessions;
    }

    return sessions.filter((chatSession) => chatSession.title.toLowerCase().includes(search));
  }, [chatSessions, sessionSearch]);

  const refreshArtifacts = useCallback(async () => {
    try {
      const response = await fetch("/api/artifacts", { headers: { accept: "application/json" } });
      const data = (await response.json()) as ArtifactListResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.ok ? "Artifact list failed." : data.error);
      }

      setArtifacts(data.artifacts);
      setArtifactError(null);
    } catch (artifactFailure) {
      setArtifactError(artifactFailure instanceof Error ? artifactFailure.message : "Artifact list is not available.");
    } finally {
      setArtifactsLoaded(true);
    }
  }, []);

  const refreshFiles = useCallback(async () => {
    try {
      const response = await fetch("/api/files", { headers: { accept: "application/json" } });
      const data = (await response.json()) as FileListResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.ok ? "File list failed." : data.error);
      }

      setFileRecords(data.files);
      setFileError(null);
    } catch (fileFailure) {
      setFileError(fileFailure instanceof Error ? fileFailure.message : "File list is not available.");
    } finally {
      setFilesLoaded(true);
    }
  }, []);

  const refreshAdminUsage = useCallback(async () => {
    if (session.role !== "admin") {
      setAdminUsageLoaded(true);
      return;
    }

    try {
      const response = await fetch("/api/admin/usage", { headers: { accept: "application/json" } });
      const data = (await response.json()) as AdminUsageResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.ok ? "Admin usage summary failed." : data.error);
      }

      setAdminUsage(data);
      setAdminUsageError(null);
    } catch (usageFailure) {
      setAdminUsageError(usageFailure instanceof Error ? usageFailure.message : "Admin usage summary is not available.");
    } finally {
      setAdminUsageLoaded(true);
    }
  }, [session.role]);

  const refreshRecipes = useCallback(async () => {
    if (!neonWorkflowEnabled) {
      setRecipes([]);
      setRecipeError(null);
      setRecipesLoaded(true);
      return;
    }

    try {
      const response = await fetch("/api/dataset-recipes", { headers: { accept: "application/json" } });
      const data = (await response.json()) as DatasetRecipeListResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.ok ? "Recipe list failed." : data.error);
      }

      setRecipes(data.recipes);
      setRecipeError(null);
    } catch (recipeFailure) {
      setRecipeError(recipeFailure instanceof Error ? recipeFailure.message : "Dataset recipes are not available.");
    } finally {
      setRecipesLoaded(true);
    }
  }, [neonWorkflowEnabled]);

  const refreshWorkspaceDocs = useCallback(async () => {
    try {
      const response = await fetch("/api/workspace-docs", { headers: { accept: "application/json" } });
      const data = (await response.json()) as WorkspaceDocListResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.ok ? "Workspace docs failed." : data.error);
      }

      setWorkspaceDocs(data.docs);
      setWorkspaceDocError(null);
    } catch (workspaceFailure) {
      setWorkspaceDocError(workspaceFailure instanceof Error ? workspaceFailure.message : "CE workspace docs are not available.");
    } finally {
      setWorkspaceDocsLoaded(true);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadSessions() {
      try {
        const response = await fetch("/api/chat-sessions", { headers: { accept: "application/json" } });
        const data = (await response.json()) as ChatSessionListResponse;

        if (!response.ok || !data.ok) {
          throw new Error(data.ok ? "Chat sessions are not available." : data.error);
        }

        if (!active) {
          return;
        }

        if (data.sessions.length > 0) {
          setChatSessions(data.sessions);
          setActiveSessionId(data.sessions[0].id);
          setMessages(data.sessions[0].messages);
        }
      } catch (sessionFailure) {
        if (!active) {
          return;
        }

        console.error("Chat sessions are not available.", sessionFailure);
      } finally {
        if (active) {
          setSessionsLoaded(true);
        }
      }
    }

    void loadSessions();

    return () => {
      active = false;
    };
  }, [setMessages]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("healthmap-codex:theme");
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    if (storedTheme === "dark" || storedTheme === "light") {
      setThemeMode(storedTheme);
      return;
    }

    setThemeMode(systemPrefersDark ? "dark" : "light");
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
    window.localStorage.setItem("healthmap-codex:theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!sessionsLoaded) {
      return;
    }

    let sessionToPersist: ChatSession | null = null;

    setChatSessions((currentSessions) => {
      const existingSession =
        currentSessions.find((chatSession) => chatSession.id === activeSessionId) ??
        ({
          ...createEmptySession(),
          id: activeSessionId,
        } satisfies ChatSession);
      const nextSession: ChatSession = {
        ...existingSession,
        title: getSessionTitle(messages),
        messages,
        updatedAt: messages.length > 0 ? Date.now() : existingSession.updatedAt,
      };
      const otherSessions = currentSessions.filter((chatSession) => chatSession.id !== activeSessionId);
      const nextSessions = [nextSession, ...otherSessions]
        .filter((chatSession) => chatSession.messages.length > 0 || chatSession.id === activeSessionId)
        .slice(0, 24);

      sessionToPersist = nextSession.messages.length > 0 ? nextSession : null;
      return nextSessions;
    });

    if (!sessionToPersist) {
      return;
    }

    const saveTimer = window.setTimeout(() => {
      const payload = sessionToPersist;

      if (!payload) {
        return;
      }

      fetch("/api/chat-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: payload.id,
          title: payload.title,
          messages: payload.messages,
        }),
      })
        .then(async (response) => {
          const data = (await response.json().catch(() => null)) as SaveChatSessionResponse | null;

          if (!response.ok || !data?.ok) {
            throw new Error(data?.ok ? "Chat session save failed." : (data?.error ?? "Chat session save failed."));
          }
        })
        .catch((sessionFailure) => {
          console.error("Chat session save failed.", sessionFailure);
        });
    }, 700);

    return () => {
      window.clearTimeout(saveTimer);
    };
  }, [activeSessionId, messages, sessionsLoaded]);

  useEffect(() => {
    void refreshArtifacts();
    void refreshFiles();
    void refreshAdminUsage();
    void refreshRecipes();
    void refreshWorkspaceDocs();
  }, [refreshAdminUsage, refreshArtifacts, refreshFiles, refreshRecipes, refreshWorkspaceDocs]);

  useEffect(() => {
    let active = true;

    if (neonWorkflowEnabled) {
      fetch("/api/schema")
        .then((response) => response.json() as Promise<SchemaResponse>)
        .then((data) => {
          if (active) {
            setSchema(data);
          }
        })
        .catch(() => {
          if (active) {
            setSchema({ ok: false, error: "Schema endpoint is not available." });
          }
        });

      fetch("/api/wards")
        .then((response) => response.json() as Promise<WardResponse>)
        .then((data) => {
          if (active) {
            setWardIndex(data);
          }
        })
        .catch(() => {
          if (active) {
            setWardIndex({ ok: false, error: "Ward endpoint is not available." });
          }
        });
    } else {
      setSchema({ ok: false, error: "Neon schema access is not enabled for this account." });
      setWardIndex({ ok: false, error: "Ward index is not enabled for this account." });
    }

    return () => {
      active = false;
    };
  }, [neonWorkflowEnabled]);

  useEffect(() => {
    if (latestHtmlArtifact) {
      setRightTab("artifact");
      setIsRightPanelOpen(true);
      return;
    }

    if (latestCodeArtifact) {
      setRightTab("code");
      setIsRightPanelOpen(true);
    }
  }, [latestHtmlArtifact, latestCodeArtifact]);

  const schemaTables = useMemo(() => (schema?.ok ? schema.tables : []), [schema]);
  const filteredSchemaTables = useMemo(() => {
    const search = schemaSearch.trim().toLowerCase();

    if (!search) {
      return schemaTables;
    }

    return schemaTables.filter(
      (table) =>
        table.tableName.toLowerCase().includes(search) ||
        table.columns.some((column) => column.columnName.toLowerCase().includes(search)),
    );
  }, [schemaSearch, schemaTables]);
  const visibleTables = useMemo(() => filteredSchemaTables.slice(0, 20), [filteredSchemaTables]);
  const selectedSchemaTable = useMemo(
    () =>
      schemaTables.find((table) => table.tableName === selectedSchemaTableName) ??
      visibleTables[0] ??
      null,
    [schemaTables, selectedSchemaTableName, visibleTables],
  );
  const visibleWards = useMemo(() => (wardIndex?.ok ? wardIndex.wards.slice(0, 12) : []), [wardIndex]);
  const visiblePreviewColumns = useMemo(() => queryPreview?.columns.slice(0, 8) ?? [], [queryPreview]);
  const visiblePreviewRows = useMemo(() => queryPreview?.rows.slice(0, 12) ?? [], [queryPreview]);
  const visibleRecipes = useMemo(() => recipes.slice(0, 6), [recipes]);
  const visibleWorkspaceDocs = useMemo(() => workspaceDocs.slice(0, 8), [workspaceDocs]);
  const recipeStarterCode = useMemo(
    () => buildRecipeStarterCode(starterLanguage, previewSql, recipeTitle),
    [previewSql, recipeTitle, starterLanguage],
  );
  const privateFileStarterCode = useMemo(
    () => buildUploadedFileStarterCode(fileStarterLanguage, selectedPrivateFile),
    [fileStarterLanguage, selectedPrivateFile],
  );
  const visibleStarterPrompts = useMemo(() => {
    const prompts: string[] = [];

    if (neonWorkflowEnabled) {
      prompts.push("Use /ce-brainstorm to frame a ward snapshot.");
      prompts.push("Help me connect this app to Neon safely.");
    }

    if (phiLocalWorkflowEnabled) {
      prompts.push("Create a marimo starter for a PHI file workflow.");
    }

    prompts.push("Review my HTML artifact before publishing.");

    return prompts;
  }, [neonWorkflowEnabled, phiLocalWorkflowEnabled]);
  const featuredSkills = useMemo(() => {
    const neonSkillIds = new Set(["ward-snapshot", "word-brief", "ppt-deck", "html-snapshot", "data-query"]);
    const phiLocalSkillIds = new Set(["phi-csv", "artifact-review"]);

    return assistantSkills
      .filter(
        (skill) =>
          (neonWorkflowEnabled && neonSkillIds.has(skill.id)) ||
          (phiLocalWorkflowEnabled && phiLocalSkillIds.has(skill.id)),
      )
      .slice(0, 6);
  }, [neonWorkflowEnabled, phiLocalWorkflowEnabled]);

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.reload();
  }

  const startNewChat = useCallback(() => {
    if (isBusy) {
      return;
    }

    const nextSession = createEmptySession();
    clearError();
    setInput("");
    setIsRightPanelOpen(false);
    setActiveSessionId(nextSession.id);
    setChatSessions((currentSessions) => [nextSession, ...currentSessions].slice(0, 24));
    setMessages([]);
  }, [clearError, isBusy, setMessages]);

  const loadChatSession = useCallback(
    (chatSession: ChatSession) => {
      if (isBusy) {
        return;
      }

      clearError();
      setInput("");
      setActiveSessionId(chatSession.id);
      setMessages(chatSession.messages);
      const hasHtmlArtifact = Boolean(findLatestHtmlArtifact(chatSession.messages));
      const hasCodeArtifact = Boolean(findLatestCodeArtifact(chatSession.messages));
      setIsRightPanelOpen(hasHtmlArtifact || hasCodeArtifact);
      setRightTab(hasHtmlArtifact ? "artifact" : "code");
    },
    [clearError, isBusy, setMessages],
  );

  async function uploadFile(file: File): Promise<UploadedFileReference> {
    const response = await fetch("/api/files/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: getSafeUploadName(file),
        sizeBytes: file.size,
      }),
    });
    const target = (await response.json()) as UploadUrlResponse;

    if (!response.ok || !target.ok) {
      throw new Error(target.ok ? "Upload URL request failed." : target.error);
    }

    const uploadResponse = await fetch(target.upload.uploadUrl, {
      method: "PUT",
      headers: target.upload.requiredHeaders,
      body: file,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });

    if (!uploadResponse.ok) {
      throw new Error("Azure Blob upload failed. Check the storage account CORS settings for this app origin.");
    }

    const completeResponse = await fetch("/api/files/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        storagePath: target.upload.storagePath,
      }),
    });
    const completeResult = (await completeResponse.json().catch(() => null)) as CompleteUploadResponse | null;

    if (!completeResponse.ok || !completeResult?.ok) {
      throw new Error(completeResult?.ok ? "Upload metadata completion failed." : (completeResult?.error ?? "Upload metadata completion failed."));
    }

    const completedFile = completeResult.file;
    const publishable = Boolean(completeResult.publishable);

    return {
      id: completedFile.id,
      uploadId: completedFile.id,
      displayLabel: completedFile.displayName,
      extension: completedFile.extension,
      contentType: completedFile.contentType,
      sizeBytes: completedFile.sizeBytes,
      uploadedAt: new Date().toISOString(),
      publishable,
    };
  }

  async function uploadSelectedFiles(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);

    if (selectedFiles.length === 0 || isUploadingFile) {
      return;
    }

    if (!phiLocalWorkflowEnabled && selectedFiles.some((file) => isPrivateDataUploadName(file.name))) {
      setUploadError("Private file uploads are enabled for PHI-local workflow accounts.");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    setIsUploadingFile(true);
    setUploadError(null);

    try {
      const uploaded: UploadedFileReference[] = [];

      for (const file of selectedFiles) {
        uploaded.push(await uploadFile(file));
      }

      setUploadedFiles((currentFiles) => [...currentFiles, ...uploaded].slice(-6));
      const latestPrivateFile = [...uploaded].reverse().find((file) => !file.publishable);
      const latestPublishableArtifact = [...uploaded].reverse().find((file) => file.publishable);

      if (latestPrivateFile) {
        setSelectedPrivateFileId(latestPrivateFile.uploadId ?? latestPrivateFile.id);
      }

      if (latestPublishableArtifact) {
        setSelectedArtifactId(latestPublishableArtifact.uploadId ?? latestPublishableArtifact.id);
      }

      await Promise.all([refreshArtifacts(), refreshFiles(), refreshAdminUsage()]);

      if (uploaded.some((file) => file.publishable)) {
        setRightTab("artifact");
        setIsRightPanelOpen(true);
      } else if (uploaded.length > 0) {
        setRightTab("artifact");
        setIsRightPanelOpen(true);
      }
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : "File upload failed.");
    } finally {
      setIsUploadingFile(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function removeUploadedFile(fileId: string) {
    setUploadedFiles((currentFiles) => currentFiles.filter((file) => file.id !== fileId));
  }

  async function updateArtifactVisibility(artifact: ArtifactRecord, visibility: "private" | "cohort") {
    if (publishingArtifactId) {
      return;
    }

    setPublishingArtifactId(artifact.id);
    setArtifactError(null);

    try {
      const response = await fetch("/api/artifacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileId: artifact.id,
          visibility,
          displayName: artifact.displayName,
          projectLabel: artifact.projectLabel,
          reviewConfirmed: visibility === "cohort",
        }),
      });
      const data = (await response.json()) as ArtifactUpdateResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.ok ? "Artifact update failed." : data.error);
      }

      setArtifacts((currentArtifacts) => {
        const nextArtifacts = currentArtifacts.map((currentArtifact) =>
          currentArtifact.id === data.artifact.id ? data.artifact : currentArtifact,
        );

        if (!nextArtifacts.some((currentArtifact) => currentArtifact.id === data.artifact.id)) {
          nextArtifacts.unshift(data.artifact);
        }

        return nextArtifacts.sort(
          (left, right) =>
            new Date(right.publishedAt ?? right.createdAt).getTime() -
            new Date(left.publishedAt ?? left.createdAt).getTime(),
        );
      });
      setSelectedArtifactId(data.artifact.id);
    } catch (artifactFailure) {
      setArtifactError(artifactFailure instanceof Error ? artifactFailure.message : "Artifact update failed.");
    } finally {
      setPublishingArtifactId(null);
    }
  }

  async function saveGeneratedHtmlArtifact() {
    if (!previewHtmlArtifact || isSavingGeneratedArtifact) {
      return;
    }

    setIsSavingGeneratedArtifact(true);
    setArtifactError(null);

    try {
      const response = await fetch("/api/artifacts/generated", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          html: previewHtmlArtifact,
          displayName: activeChatTitle === "New chat" ? "Generated HTML artifact" : activeChatTitle,
          projectLabel: "Generated in chat",
        }),
      });
      const data = (await response.json()) as SaveGeneratedArtifactResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.ok ? "Generated artifact save failed." : data.error);
      }

      setArtifacts((currentArtifacts) => [data.artifact, ...currentArtifacts.filter((artifact) => artifact.id !== data.artifact.id)]);
      setSelectedArtifactId(data.artifact.id);
      await refreshAdminUsage();
    } catch (artifactFailure) {
      setArtifactError(artifactFailure instanceof Error ? artifactFailure.message : "Generated artifact save failed.");
    } finally {
      setIsSavingGeneratedArtifact(false);
    }
  }

  async function runQueryPreview() {
    if (isPreviewingQuery) {
      return;
    }

    if (!neonWorkflowEnabled) {
      setQueryPreview(null);
      setQueryPreviewError("Neon query preview is not enabled for this account.");
      return;
    }

    setIsPreviewingQuery(true);
    setQueryPreviewError(null);

    try {
      const response = await fetch("/api/query-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sql: previewSql,
          limit: 50,
        }),
      });
      const data = (await response.json()) as QueryPreviewResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.ok ? "Query preview failed." : data.error);
      }

      setQueryPreview(data);
      await refreshAdminUsage();
    } catch (queryFailure) {
      setQueryPreview(null);
      setQueryPreviewError(queryFailure instanceof Error ? queryFailure.message : "Query preview failed.");
      await refreshAdminUsage();
    } finally {
      setIsPreviewingQuery(false);
    }
  }

  async function saveDatasetRecipe() {
    if (savingRecipe) {
      return;
    }

    if (!neonWorkflowEnabled) {
      setRecipeError("Dataset recipes from Neon SQL are not enabled for this account.");
      return;
    }

    setSavingRecipe(true);
    setRecipeError(null);

    try {
      const response = await fetch("/api/dataset-recipes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: recipeTitle,
          naturalLanguageRequest: recipeRequest,
          sqlText: previewSql,
          rowGrain: recipeRowGrain,
          status: "ready",
        }),
      });
      const data = (await response.json()) as SaveDatasetRecipeResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.ok ? "Recipe save failed." : data.error);
      }

      setRecipes((currentRecipes) => [
        data.recipe,
        ...currentRecipes.filter((recipe) => recipe.id !== data.recipe.id),
      ]);
      setRecipeError(null);
    } catch (recipeFailure) {
      setRecipeError(recipeFailure instanceof Error ? recipeFailure.message : "Recipe save failed.");
    } finally {
      setSavingRecipe(false);
    }
  }

  async function saveWorkspaceDoc(docType: "work_log" | "compound_learning") {
    if (savingWorkspaceDoc) {
      return;
    }

    setSavingWorkspaceDoc(docType);
    setWorkspaceDocError(null);

    try {
      const visibility = docType === "compound_learning" ? "shared" : "private";
      const response = await fetch("/api/workspace-docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          docType,
          title: activeChatTitle === "New chat" ? (docType === "compound_learning" ? "Shared CE learning" : "CE work log") : activeChatTitle,
          bodyMd: buildWorkspaceDocBody(messages),
          sourceCommand: docType === "compound_learning" ? "/ce-compound" : "/ce-work",
          projectLabel: session.workflowMode === "phi_local" ? "PHI local workflow" : "HealthMap workflow",
          visibility,
        }),
      });
      const data = (await response.json()) as SaveWorkspaceDocResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.ok ? "CE workspace doc save failed." : data.error);
      }

      setWorkspaceDocs((currentDocs) => [
        data.doc,
        ...currentDocs.filter((doc) => doc.id !== data.doc.id),
      ]);
      setRightTab("workspace");
      setIsRightPanelOpen(true);
    } catch (workspaceFailure) {
      setWorkspaceDocError(workspaceFailure instanceof Error ? workspaceFailure.message : "CE workspace doc save failed.");
    } finally {
      setSavingWorkspaceDoc(null);
    }
  }

  function loadDatasetRecipe(recipe: DatasetRecipeRecord) {
    setPreviewSql(recipe.sqlText);
    setRecipeTitle(recipe.title);
    setRecipeRequest(recipe.naturalLanguageRequest);
    setRecipeRowGrain(recipe.rowGrain ?? "");
    setQueryPreview(null);
    setQueryPreviewError(null);
  }

  function openArtifact(artifact: ArtifactRecord) {
    const url = `/api/artifacts/open?id=${encodeURIComponent(artifact.id)}`;

    if (artifact.extension === ".html" || artifact.extension === ".htm") {
      setSelectedArtifactId(artifact.id);
      setRightTab("artifact");
      setIsRightPanelOpen(true);
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  function openFile(file: ArtifactRecord) {
    const url = `/api/files/open?id=${encodeURIComponent(file.id)}`;

    window.open(url, "_blank", "noopener,noreferrer");
  }

  function submitMessage(text: string) {
    const trimmed = text.trim();

    if (!trimmed || isBusy) {
      return;
    }

    const uploadedFileContext = buildUploadedFileContext(uploadedFiles);
    const messageText = uploadedFileContext ? `${trimmed}\n\n${uploadedFileContext}` : trimmed;

    sendMessage({ text: messageText });
    setInput("");
    setUploadedFiles([]);
  }

  function openRightPanel(tab: "artifact" | "code" | "neon" | "plugin" | "workspace" | "admin") {
    setRightTab(tab);
    setIsRightPanelOpen(true);
  }

  function launchCeSkill(command: string, title: string, purpose: string) {
    submitMessage(
      `Teach me how to use ${command} (${title}) from the Compound Engineering plugin for a HealthMap or internship coding project. Purpose: ${purpose}. Use checkpoints and do not just produce the final answer.`,
    );
  }

  return (
    <div className={`vc-app ${isRightPanelOpen ? "panel-open" : ""}`} data-theme={themeMode}>
      <aside className="vc-sidebar">
        <div className="vc-sidebar-header">
          <div className="vc-mark">
            <Bot size={18} aria-hidden="true" />
          </div>
          <div>
            <strong>RHEAS Intern AI Chat</strong>
            <span>{session.displayName} · {formatWorkflowMode(session.workflowMode)}</span>
          </div>
        </div>

        <button className="vc-new-chat" disabled={isBusy} type="button" onClick={startNewChat}>
          <PenSquare size={16} aria-hidden="true" />
          New chat
        </button>

        <label className="vc-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={sessionSearch}
            onChange={(event) => setSessionSearch(event.target.value)}
            placeholder="Search chats..."
          />
        </label>

        <nav className="vc-sidebar-links" aria-label="App actions">
          <a href="/how-to-use">
            <BookOpen size={15} aria-hidden="true" />
            How to use
          </a>
          {neonWorkflowEnabled ? (
            <button type="button" onClick={() => openRightPanel("neon")}>
              <Database size={15} aria-hidden="true" />
              Neon connection
            </button>
          ) : (
            <button type="button" onClick={() => openRightPanel("artifact")}>
              <Paperclip size={15} aria-hidden="true" />
              Local files
            </button>
          )}
          <button type="button" onClick={() => openRightPanel("plugin")}>
            <GitBranch size={15} aria-hidden="true" />
            CE plugin
          </button>
          <button type="button" onClick={() => openRightPanel("workspace")}>
            <FileText size={15} aria-hidden="true" />
            CE docs
          </button>
          {session.role === "admin" ? (
            <button type="button" onClick={() => openRightPanel("admin")}>
              <ReceiptText size={15} aria-hidden="true" />
              Admin usage
            </button>
          ) : null}
          <button type="button" onClick={() => setThemeMode(nextThemeMode)}>
            {themeMode === "dark" ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
            {themeMode === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </nav>

        <section className="vc-sidebar-section">
          <h2>Chats</h2>
          <div className="vc-history-list">
            {filteredChatSessions.length > 0 ? (
              filteredChatSessions.map((chatSession) => (
                <button
                  className={`vc-history-item ${chatSession.id === activeSessionId ? "active" : ""}`}
                  disabled={isBusy}
                  key={chatSession.id}
                  type="button"
                  onClick={() => loadChatSession(chatSession)}
                >
                  <History size={15} aria-hidden="true" />
                  <span>
                    <strong>{chatSession.title}</strong>
                    <small>{new Date(chatSession.updatedAt).toLocaleDateString()}</small>
                  </span>
                </button>
              ))
            ) : (
              <p className="vc-empty-note">Saved chats appear after you send a message.</p>
            )}
          </div>
        </section>

        <section className="vc-sidebar-section">
          <h2>Quick starts</h2>
          <div className="vc-history-list">
            {visibleStarterPrompts.map((prompt) => (
              <button className="vc-history-item" disabled={isBusy} key={prompt} type="button" onClick={() => submitMessage(prompt)}>
                <TerminalSquare size={15} aria-hidden="true" />
                <span>
                  <strong>{prompt}</strong>
                </span>
              </button>
            ))}
          </div>
        </section>

        <button className="vc-sign-out" type="button" onClick={logout}>
          <LogOut size={15} aria-hidden="true" />
          Sign out
        </button>
      </aside>

      <main className="vc-main">
        <header className="vc-header">
          <div>
            <h1>RHEAS Intern AI Chat</h1>
            <p>Vercel Chatbot pattern, with HealthMap data, Neon, artifacts, and CE plugin skills built in.</p>
          </div>
          <div className="vc-status-pills">
            <span className={schema?.ok ? "ok" : ""}>
              <Database size={14} aria-hidden="true" />
              {schema?.ok ? `${schema.tableCount} Neon tables` : session.workflowMode === "phi_local" ? "PHI local mode" : "Neon setup"}
            </span>
            <span>
              <GitBranch size={14} aria-hidden="true" />
              {cePluginSkills.length} CE skills
            </span>
            <button
              disabled={!hasArtifactPanelContent && !latestCodeArtifact}
              type="button"
              onClick={() => openRightPanel(hasArtifactPanelContent ? "artifact" : "code")}
            >
              <PanelRightOpen size={14} aria-hidden="true" />
              Output pane
            </button>
          </div>
        </header>

        <section className="vc-chat-panel">
          <div className="vc-messages">
            {messages.length === 0 ? (
              <div className="vc-greeting">
                <div className="vc-greeting-mark">
                  <Bot size={22} aria-hidden="true" />
                </div>
                <h2>What can I help with?</h2>
                <p>Ask for a ward snapshot, a Neon query plan, a PHI file coding workflow, or a CE review.</p>
                <div className="vc-suggestions">
                  {featuredSkills.map((skill) => {
                    const Icon = skill.icon;
                    return (
                      <button disabled={isBusy} key={skill.id} type="button" onClick={() => submitMessage(skill.prompt)}>
                        <Icon size={16} aria-hidden="true" />
                        <span>{skill.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {messages.map((message) => (
              <article className={`vc-message ${message.role === "user" ? "user" : "assistant"}`} key={message.id}>
                <div className="vc-message-avatar">
                  {message.role === "user" ? <User size={16} aria-hidden="true" /> : <Bot size={16} aria-hidden="true" />}
                </div>
                <div className="vc-message-content">
                  {message.parts.map((part, index) =>
                    part.type === "text" ? <MessageText key={`${message.id}-${index}`} text={part.text} /> : null,
                  )}
                </div>
              </article>
            ))}

            {isBusy ? (
              <article className="vc-message assistant">
                <div className="vc-message-avatar">
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                </div>
                <div className="vc-message-content muted">Thinking through code, data, and CE workflow...</div>
              </article>
            ) : null}

            {error ? (
              <div className="vc-error">
                {getChatErrorMessage(error)}
                <button type="button" onClick={() => regenerate()}>
                  Retry
                </button>
              </div>
            ) : null}
          </div>

          <form
            className="vc-prompt"
            onSubmit={(event) => {
              event.preventDefault();
              submitMessage(input);
            }}
          >
            <div className="vc-prompt-safety" role="note">
              <ShieldCheck size={14} aria-hidden="true" />
              <span>{promptSafetyText}</span>
            </div>
            <textarea
              aria-label="Message"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitMessage(input);
                }
              }}
              placeholder="Message RHEAS Intern AI Chat..."
              rows={3}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={uploadAccept}
              className="vc-file-input"
              onChange={(event) => uploadSelectedFiles(event.currentTarget.files)}
            />
            {uploadedFiles.length > 0 || uploadError ? (
              <div className="vc-file-tray">
                {uploadedFiles.map((file) => (
                  <span className="vc-file-chip" key={file.id}>
                    <ShieldCheck size={13} aria-hidden="true" />
                    <span>
                      {file.displayLabel}
                      <small>
                        {formatFileSize(file.sizeBytes)} · private file record{file.publishable ? " · draft artifact" : ""}
                      </small>
                    </span>
                    <button type="button" onClick={() => removeUploadedFile(file.id)} title="Remove file">
                      <X size={13} aria-hidden="true" />
                    </button>
                  </span>
                ))}
                {uploadError ? <span className="vc-file-error">{uploadError}</span> : null}
              </div>
            ) : null}
            <div className="vc-prompt-footer">
              <div className="vc-prompt-tools">
                <button
                  disabled={isBusy || isUploadingFile}
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {isUploadingFile ? (
                    <LoaderCircle className="spin" size={14} aria-hidden="true" />
                  ) : (
                    <Paperclip size={14} aria-hidden="true" />
                  )}
                  {isUploadingFile ? "Uploading" : "Upload"}
                </button>
                {wardArtifactFormats.map((format) => {
                  const Icon = format.icon;
                  return (
                    <button disabled={isBusy} key={format.label} type="button" onClick={() => submitMessage(format.prompt)}>
                      <Icon size={14} aria-hidden="true" />
                      {format.label}
                    </button>
                  );
                })}
              </div>
              {isBusy ? (
                <button className="vc-submit" type="button" onClick={() => stop()} title="Stop">
                  <Square size={17} aria-hidden="true" />
                </button>
              ) : (
                <button className="vc-submit" type="submit" disabled={!input.trim()} title="Send">
                  <Send size={17} aria-hidden="true" />
                </button>
              )}
            </div>
          </form>
        </section>
      </main>

      {isRightPanelOpen ? (
      <aside className="vc-artifact">
        <div className="vc-tabs" role="tablist" aria-label="Right panel">
          <button
            className={rightTab === "artifact" ? "active" : ""}
            disabled={!hasArtifactPanelContent}
            type="button"
            onClick={() => setRightTab("artifact")}
          >
            <Globe2 size={14} aria-hidden="true" />
            Artifact
          </button>
          <button
            className={rightTab === "code" ? "active" : ""}
            disabled={!latestCodeArtifact}
            type="button"
            onClick={() => setRightTab("code")}
          >
            <Code2 size={14} aria-hidden="true" />
            Code
          </button>
          {neonWorkflowEnabled ? (
            <button className={rightTab === "neon" ? "active" : ""} type="button" onClick={() => setRightTab("neon")}>
              <Database size={14} aria-hidden="true" />
              Neon
            </button>
          ) : null}
          <button className={rightTab === "plugin" ? "active" : ""} type="button" onClick={() => setRightTab("plugin")}>
            <GitBranch size={14} aria-hidden="true" />
            Plugin
          </button>
          <button className={rightTab === "workspace" ? "active" : ""} type="button" onClick={() => setRightTab("workspace")}>
            <FileText size={14} aria-hidden="true" />
            CE docs
          </button>
          {session.role === "admin" ? (
            <button className={rightTab === "admin" ? "active" : ""} type="button" onClick={() => setRightTab("admin")}>
              <ReceiptText size={14} aria-hidden="true" />
              Admin
            </button>
          ) : null}
          <button className="vc-panel-close" type="button" onClick={() => setIsRightPanelOpen(false)} title="Close panel">
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {rightTab === "artifact" ? (
          <>
            <section className="vc-panel-card vc-preview-card">
              <div className="vc-panel-heading">
                <div>
                  <h2>Artifact preview</h2>
                  <p>Generated or uploaded HTML opens here without leaving chat.</p>
                </div>
                <div className="vc-artifact-actions">
                  {previewHtmlArtifact ? (
                    <button type="button" disabled={isSavingGeneratedArtifact} onClick={() => saveGeneratedHtmlArtifact()}>
                      {isSavingGeneratedArtifact ? (
                        <LoaderCircle className="spin" size={13} aria-hidden="true" />
                      ) : (
                        <FileText size={13} aria-hidden="true" />
                      )}
                      Save draft
                    </button>
                  ) : null}
                  <span className={`vc-dot ${latestHtmlArtifact || selectedArtifactIsHtml ? "ok" : ""}`} />
                </div>
              </div>
              {selectedArtifactUrl && selectedArtifactIsHtml ? (
                <iframe sandbox="" src={selectedArtifactUrl} title={`${selectedArtifact?.displayName ?? "HTML artifact"} preview`} />
              ) : previewHtmlArtifact ? (
                <iframe sandbox="" srcDoc={previewHtmlArtifact} title="HTML artifact preview" />
              ) : (
                <div className="vc-preview-empty">Ask for a final fenced HTML artifact, or choose Open on an uploaded HTML artifact.</div>
              )}
            </section>

            <section className="vc-panel-card">
              <div className="vc-panel-heading">
                <div>
                  <h2>Artifact library</h2>
                  <p>Drafts stay private. Published artifacts are visible to the cohort.</p>
                </div>
                <span className={`vc-badge ${visibleArtifacts.some((artifact) => artifact.visibility === "cohort") ? "ok" : ""}`}>
                  {visibleArtifacts.length}
                </span>
              </div>

              {artifactError ? <div className="vc-panel-error">{artifactError}</div> : null}

              <div className="vc-artifact-list">
                {visibleArtifacts.length > 0 ? (
                  visibleArtifacts.map((artifact) => (
                    <article className="vc-artifact-row" key={artifact.id}>
	                      <div className="vc-artifact-row-main">
	                        <FileText size={15} aria-hidden="true" />
	                        <span>
                          <strong>{artifact.displayName}</strong>
                          <small>
                            {formatArtifactKind(artifact.artifactKind)} · {formatFileSize(artifact.sizeBytes)} · {artifact.ownerUsername} ·{" "}
                            {artifact.visibility === "cohort" ? `Published ${formatArtifactDate(artifact.publishedAt)}` : "Private draft"}
	                          </small>
	                        </span>
	                      </div>
	                      <div className="vc-artifact-actions">
	                        <button type="button" onClick={() => openArtifact(artifact)}>
	                          <ExternalLink size={13} aria-hidden="true" />
	                          Open
	                        </button>
	                        {artifact.canEdit ? (
	                          <button
	                            disabled={publishingArtifactId === artifact.id}
	                            type="button"
	                            onClick={() =>
	                              updateArtifactVisibility(artifact, artifact.visibility === "cohort" ? "private" : "cohort")
	                            }
	                          >
	                            {publishingArtifactId === artifact.id ? (
	                              <LoaderCircle className="spin" size={13} aria-hidden="true" />
	                            ) : artifact.visibility === "cohort" ? (
	                              <ShieldCheck size={13} aria-hidden="true" />
	                            ) : (
	                              <Globe2 size={13} aria-hidden="true" />
	                            )}
	                            {artifact.visibility === "cohort" ? "Make private" : "Publish"}
	                          </button>
	                        ) : (
	                          <span className="vc-artifact-shared">
	                            <Globe2 size={13} aria-hidden="true" />
	                            Shared
	                          </span>
	                        )}
	                      </div>
	                    </article>
                  ))
                ) : (
                  <div className="vc-preview-empty">
                    {artifactsLoaded ? "Upload HTML, Word, or PowerPoint artifacts to see drafts here." : "Loading artifacts..."}
                  </div>
                )}
              </div>
            </section>

            <section className="vc-panel-card">
              <div className="vc-panel-heading">
                <div>
                  <h2>Private files</h2>
                  <p>Uploaded data, notebook, and code files stay scoped to you and admins.</p>
                </div>
                <span className={`vc-badge ${visiblePrivateFiles.length > 0 ? "ok" : ""}`}>
                  {visiblePrivateFiles.length}
                </span>
              </div>

              {fileError ? <div className="vc-panel-error">{fileError}</div> : null}

              <div className="vc-artifact-list">
                {visiblePrivateFiles.length > 0 ? (
                  visiblePrivateFiles.map((file) => (
                    <article className="vc-artifact-row" key={file.id}>
                      <div className="vc-artifact-row-main">
                        <ShieldCheck size={15} aria-hidden="true" />
                        <span>
                          <strong>{file.displayName}</strong>
                          <small>
                            {formatPrivateFileKind(file.extension)} · {file.extension.toUpperCase().replace(".", "")} · {formatFileSize(file.sizeBytes)} · {file.ownerUsername} · Private
                          </small>
                        </span>
                      </div>
                      <div className="vc-artifact-actions">
                        <button type="button" onClick={() => setSelectedPrivateFileId(file.id)}>
                          <Code2 size={13} aria-hidden="true" />
                          Use
                        </button>
                        <button type="button" onClick={() => openFile(file)}>
                          <ExternalLink size={13} aria-hidden="true" />
                          Download
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="vc-preview-empty">
                    {filesLoaded ? "Upload data, notebook, or code files to see private file records here." : "Loading files..."}
                  </div>
                )}
              </div>
              {selectedPrivateFile ? (
                <div className="vc-starter-code">
                  <div className="vc-panel-heading">
                    <div>
                      <h3>Local file starter</h3>
                      <p>
                        Selected: {selectedPrivateFile.displayName}. Copy this to an approved local or Rush machine; starters write local outputs and an aggregate-summary HTML scaffold.
                      </p>
                    </div>
                  </div>
                  <div className="vc-starter-tabs" role="tablist" aria-label="Private file starter code language">
                    {starterLanguageLabels.map((item) => (
                      <button
                        className={fileStarterLanguage === item.language ? "active" : ""}
                        key={`file-${item.language}`}
                        type="button"
                        onClick={() => setFileStarterLanguage(item.language)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <CodeBlock language={fileStarterLanguage === "r" ? "r" : "python"} value={privateFileStarterCode} />
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {rightTab === "code" ? (
          <section className="vc-panel-card vc-code-pane">
            <div className="vc-panel-heading">
              <div>
                <h2>Code output</h2>
                <p>Latest non-HTML code block from the assistant.</p>
              </div>
              <span className={`vc-dot ${latestCodeArtifact ? "ok" : ""}`} />
            </div>
            {latestCodeArtifact ? (
              <CodeBlock language={latestCodeArtifact.language} value={latestCodeArtifact.value} />
            ) : (
              <div className="vc-preview-empty">Code appears here when the assistant produces a fenced code block.</div>
            )}
          </section>
        ) : null}

        {rightTab === "neon" ? (
          <section className="vc-panel-card">
            <div className="vc-panel-heading">
              <div>
                <h2>Neon database</h2>
                <p>
                  {schema?.ok
                    ? "Server-side read-only schema is connected."
                    : session.workflowMode === "phi_local"
                      ? "This account is set up for PHI-scrubbed local analysis, not Neon browsing."
                      : "Add READONLY_DATABASE_URL."}
                </p>
              </div>
              <span className={`vc-badge ${schema?.ok ? "ok" : ""}`}>{schema?.ok ? "Connected" : "Setup"}</span>
            </div>

            <div className="vc-card-list">
              <button
                type="button"
                onClick={() =>
                  submitMessage(
                    "Guide me through connecting the app to Neon. Include required env vars, read-only role checks, and how to verify schema access.",
                  )
                }
              >
                <Database size={15} aria-hidden="true" />
                App env setup
              </button>
              <a href={neonDocsUrl} rel="noreferrer" target="_blank">
                <ExternalLink size={15} aria-hidden="true" />
                Neon MCP docs
              </a>
            </div>

            <div className="vc-query-box">
              <div className="vc-panel-heading">
                <div>
                  <h3>Read-only preview</h3>
                  <p>Runs one SELECT/WITH statement through the server read-only role with a small row cap.</p>
                </div>
                <button disabled={isPreviewingQuery || !neonWorkflowEnabled || !schema?.ok} type="button" onClick={runQueryPreview}>
                  {isPreviewingQuery ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Database size={14} aria-hidden="true" />}
                  Preview
                </button>
              </div>
              <textarea
                aria-label="Read-only SQL preview"
                disabled={isPreviewingQuery || !neonWorkflowEnabled || !schema?.ok}
                value={previewSql}
                onChange={(event) => setPreviewSql(event.target.value)}
                rows={5}
              />
              {queryPreviewError ? <div className="vc-panel-error">{queryPreviewError}</div> : null}
              {queryPreview ? (
                <div className="vc-query-result">
                  <small>
                    {queryPreview.rowCount.toLocaleString()} rows returned · limit {queryPreview.limit} · timeout{" "}
                    {queryPreview.timeoutMs.toLocaleString()} ms · {queryPreview.durationMs} ms
                  </small>
                  {visiblePreviewRows.length > 0 && visiblePreviewColumns.length > 0 ? (
                    <div className="vc-query-table-wrap">
                      <table className="vc-query-table">
                        <thead>
                          <tr>
                            {visiblePreviewColumns.map((column) => (
                              <th key={column}>{column}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {visiblePreviewRows.map((row, rowIndex) => (
                            <tr key={`preview-row-${rowIndex}`}>
                              {visiblePreviewColumns.map((column) => (
                                <td key={`${rowIndex}-${column}`}>{String(row[column] ?? "")}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="vc-preview-empty">Query ran successfully and returned no rows.</div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="vc-query-box">
              <div className="vc-panel-heading">
                <div>
                  <h3>Dataset recipes</h3>
                  <p>Save reusable SQL plus the request and row grain for local Python, R, Jupyter, or marimo work.</p>
                </div>
                <button disabled={savingRecipe || !neonWorkflowEnabled || !schema?.ok} type="button" onClick={saveDatasetRecipe}>
                  {savingRecipe ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
                  Save
                </button>
              </div>
              <div className="vc-recipe-form">
                <input
                  aria-label="Recipe title"
                  disabled={savingRecipe || !neonWorkflowEnabled || !schema?.ok}
                  value={recipeTitle}
                  onChange={(event) => setRecipeTitle(event.target.value)}
                  placeholder="Recipe title"
                />
                <input
                  aria-label="Natural-language request"
                  disabled={savingRecipe || !neonWorkflowEnabled || !schema?.ok}
                  value={recipeRequest}
                  onChange={(event) => setRecipeRequest(event.target.value)}
                  placeholder="Natural-language request"
                />
                <input
                  aria-label="Row grain"
                  disabled={savingRecipe || !neonWorkflowEnabled || !schema?.ok}
                  value={recipeRowGrain}
                  onChange={(event) => setRecipeRowGrain(event.target.value)}
                  placeholder="Row grain"
                />
              </div>
              {recipeError ? <div className="vc-panel-error">{recipeError}</div> : null}
              <div className="vc-artifact-list">
                {visibleRecipes.length > 0 ? (
                  visibleRecipes.map((recipe) => (
                    <article className="vc-artifact-row" key={recipe.id}>
                      <div className="vc-artifact-row-main">
                        <FileText size={15} aria-hidden="true" />
                        <span>
                          <strong>{recipe.title}</strong>
                          <small>
                            {recipe.ownerUsername} · {recipe.rowGrain ?? "Row grain not set"} · {new Date(recipe.updatedAt).toLocaleDateString()}
                          </small>
                        </span>
                      </div>
                      <div className="vc-artifact-actions">
                        <button type="button" onClick={() => loadDatasetRecipe(recipe)}>
                          <Database size={13} aria-hidden="true" />
                          Load
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="vc-preview-empty">
                    {recipesLoaded ? "Saved dataset recipes appear here after you save a preview query." : "Loading recipes..."}
                  </div>
                )}
              </div>
              <div className="vc-starter-code">
                <div className="vc-panel-heading">
                  <div>
                    <h3>Local starter code</h3>
                    <p>Copy this to an approved local or Rush machine. Configure credentials outside the notebook or script.</p>
                  </div>
                </div>
                <div className="vc-starter-tabs" role="tablist" aria-label="Starter code language">
                  {starterLanguageLabels.map((item) => (
                    <button
                      className={starterLanguage === item.language ? "active" : ""}
                      key={item.language}
                      type="button"
                      onClick={() => setStarterLanguage(item.language)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <CodeBlock language={starterLanguage === "r" ? "r" : "python"} value={recipeStarterCode} />
              </div>
            </div>

            <div className="vc-schema-browser">
              <div className="vc-panel-heading">
                <div>
                  <h3>Schema browser</h3>
                  <p>Search tables or columns before writing SQL.</p>
                </div>
                <span className={`vc-badge ${schema?.ok ? "ok" : ""}`}>
                  {schema?.ok ? `${schema.tableCount} tables` : "Setup"}
                </span>
              </div>
              <input
                aria-label="Search tables and columns"
                disabled={!neonWorkflowEnabled || !schema?.ok}
                placeholder="Search tables or columns"
                value={schemaSearch}
                onChange={(event) => setSchemaSearch(event.target.value)}
              />
              <div className="vc-schema-layout">
                <ul className="vc-table-list">
                  {visibleTables.length > 0 ? (
                    visibleTables.map((table) => (
                      <li className={selectedSchemaTable?.tableName === table.tableName ? "active" : ""} key={table.tableName}>
                        <button type="button" onClick={() => setSelectedSchemaTableName(table.tableName)}>
                          <strong>{table.tableName}</strong>
                          <span>{table.columns.length} columns · {table.rowEstimate.toLocaleString()} rows</span>
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="empty">{schema?.ok ? "No matching tables or columns." : "Schema appears after Neon is configured."}</li>
                  )}
                </ul>
                <div className="vc-schema-detail">
                  {selectedSchemaTable ? (
                    <>
                      <strong>{selectedSchemaTable.tableName}</strong>
                      <span>
                        {selectedSchemaTable.columns.length} columns · {selectedSchemaTable.rowEstimate.toLocaleString()} rows
                      </span>
                      <div className="vc-column-list">
                        {selectedSchemaTable.columns.map((column) => (
                          <code key={`${selectedSchemaTable.tableName}-${column.columnName}`}>
                            {column.columnName} <span>{column.dataType}</span>
                          </code>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="vc-preview-empty">Select a table to inspect its columns.</div>
                  )}
                </div>
              </div>
            </div>

            <h3>Wards</h3>
            <div className="vc-ward-grid">
              {visibleWards.length > 0 ? (
                visibleWards.map((ward) => (
                  <button
                    disabled={isBusy}
                    key={ward.wardId}
                    type="button"
                    onClick={() => submitMessage(`Start a HealthMap ward snapshot workflow for Ward ${ward.wardId}.`)}
                  >
                    Ward {ward.wardId}
                  </button>
                ))
              ) : (
                <span>Ward chips appear after Neon is configured.</span>
              )}
            </div>
          </section>
        ) : null}

        {rightTab === "plugin" ? (
          <section className="vc-panel-card">
            <div className="vc-panel-heading">
              <div>
                <h2>Compound Engineering</h2>
                <p>Full plugin workflow built into the chat.</p>
              </div>
              <span className="vc-badge ok">{cePluginSkills.length} skills</span>
            </div>

            <div className="vc-card-list">
              <a href={compoundPluginUrl} rel="noreferrer" target="_blank">
                <ExternalLink size={15} aria-hidden="true" />
                Plugin repo
              </a>
              {commandBlocks.slice(0, 2).map((block) => (
                <button key={block.label} type="button" onClick={() => submitMessage(`Help me with ${block.label}: ${block.command}`)}>
                  <Code2 size={15} aria-hidden="true" />
                  {block.label}
                </button>
              ))}
            </div>

            <div className="vc-ce-grid">
              {cePluginSkills.map((skill) => {
                const Icon = skill.icon;
                return (
                  <button
                    disabled={isBusy}
                    key={skill.id}
                    type="button"
                    onClick={() => launchCeSkill(skill.command, skill.title, skill.purpose)}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span>{skill.command}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {rightTab === "workspace" ? (
          <section className="vc-panel-card">
            <div className="vc-panel-heading">
              <div>
                <h2>CE workspace docs</h2>
                <p>Save private work logs, or share reviewed compound learnings with the cohort.</p>
              </div>
              <button type="button" onClick={() => refreshWorkspaceDocs()}>
                <FileText size={14} aria-hidden="true" />
                Refresh
              </button>
            </div>

            <div className="vc-card-list">
              <button disabled={savingWorkspaceDoc !== null || messages.length === 0} type="button" onClick={() => saveWorkspaceDoc("work_log")}>
                {savingWorkspaceDoc === "work_log" ? (
                  <LoaderCircle className="spin" size={15} aria-hidden="true" />
                ) : (
                  <History size={15} aria-hidden="true" />
                )}
                Save private work log
              </button>
              <button
                disabled={savingWorkspaceDoc !== null || messages.length === 0}
                type="button"
                onClick={() => saveWorkspaceDoc("compound_learning")}
              >
                {savingWorkspaceDoc === "compound_learning" ? (
                  <LoaderCircle className="spin" size={15} aria-hidden="true" />
                ) : (
                  <GitBranch size={15} aria-hidden="true" />
                )}
                Share compound learning
              </button>
            </div>

            {workspaceDocError ? <div className="vc-panel-error">{workspaceDocError}</div> : null}

            <div className="vc-artifact-list">
              {visibleWorkspaceDocs.length > 0 ? (
                visibleWorkspaceDocs.map((doc) => (
                  <article className="vc-artifact-row" key={doc.id}>
                    <div className="vc-artifact-row-main">
                      <FileText size={15} aria-hidden="true" />
                      <span>
                        <strong>{doc.title}</strong>
                        <small>
                          {formatWorkspaceDocType(doc.docType)} · {doc.ownerUsername} ·{" "}
                          {doc.visibility === "shared" ? "Shared learning" : "Private"} ·{" "}
                          {new Date(doc.updatedAt).toLocaleDateString()}
                        </small>
                      </span>
                    </div>
                    <span className="vc-artifact-shared">
                      {doc.canEdit ? "Editable" : "Read only"}
                    </span>
                  </article>
                ))
              ) : (
                <div className="vc-preview-empty">
                  {workspaceDocsLoaded ? "Save a CE work log or compound learning from the current chat." : "Loading CE docs..."}
                </div>
              )}
            </div>
          </section>
        ) : null}

        {rightTab === "admin" && session.role === "admin" ? (
          <section className="vc-panel-card">
            <div className="vc-panel-heading">
              <div>
                <h2>Usage</h2>
                <p>{adminUsage ? `${adminUsage.windowDays}-day model and upload summary.` : "Model and upload activity by account."}</p>
              </div>
              <button type="button" onClick={() => refreshAdminUsage()}>
                <ReceiptText size={14} aria-hidden="true" />
                Refresh
              </button>
            </div>

            {adminUsageError ? <div className="vc-panel-error">{adminUsageError}</div> : null}

            {adminUsage ? (
              <>
                <ul className="vc-mode-list">
                  {adminUsage.budgetWarnings.length > 0 ? (
                    <li>
                      <ShieldCheck size={15} aria-hidden="true" />
                      <span>
                        <strong>Budget warnings</strong>
                        {adminUsage.budgetWarnings.map((warning) => warning.message).join(" ")}
                      </span>
                    </li>
                  ) : null}
                  <li>
                    <Bot size={15} aria-hidden="true" />
                    <span>
                      <strong>{adminUsage.totals.requestCount.toLocaleString()} AI requests</strong>
                      {adminUsage.totals.totalTokens.toLocaleString()} tokens · {formatCost(adminUsage.totals.estimatedCostUsd)} 30d ·{" "}
                      {formatCost(adminUsage.totals.monthlyEstimatedCostUsd)} month to date ·{" "}
                      {adminUsage.totals.failedRequestCount.toLocaleString()} blocked/failed
                    </span>
                  </li>
                  <li>
                    <Paperclip size={15} aria-hidden="true" />
                    <span>
                      <strong>{adminUsage.totals.uploadCount.toLocaleString()} uploads</strong>
                      {formatFileSize(adminUsage.totals.uploadBytes)} stored in private Blob-backed file records
                    </span>
                  </li>
                  <li>
                    <ShieldCheck size={15} aria-hidden="true" />
                    <span>
                      <strong>Budgets</strong>
                      Daily/user {adminUsage.budgets.perUserDailyUsd === null ? "unset" : formatCost(adminUsage.budgets.perUserDailyUsd)} · monthly{" "}
                      {adminUsage.budgets.monthlyUsd === null ? "unset" : formatCost(adminUsage.budgets.monthlyUsd)}
                    </span>
                  </li>
                  <li>
                    <Database size={15} aria-hidden="true" />
                    <span>
                      <strong>{adminUsage.totals.queryCount.toLocaleString()} query previews</strong>
                      {adminUsage.totals.failedQueryCount.toLocaleString()} blocked or failed in the last {adminUsage.windowDays} days
                    </span>
                  </li>
                  <li>
                    <History size={15} aria-hidden="true" />
                    <span>
                      <strong>{adminUsage.totals.chatSessionCount.toLocaleString()} saved chat sessions</strong>
                      Durable intern workspaces synced to app-private metadata
                    </span>
                  </li>
                </ul>

                <h3>Accounts</h3>
                <div className="vc-artifact-list">
                  {adminUsage.users.length > 0 ? (
                    adminUsage.users.map((user) => (
                      <article className="vc-artifact-row" key={user.username}>
                        <div className="vc-artifact-row-main">
                          <ReceiptText size={15} aria-hidden="true" />
                          <span>
                            <strong>{user.displayName}</strong>
                            <small>
                              {user.username} · {formatWorkflowMode(user.workflowMode)} · {user.requestCount.toLocaleString()} requests ·{" "}
                              {user.failedRequestCount.toLocaleString()} blocked/failed ·{" "}
                              {user.totalTokens.toLocaleString()} tokens · {formatCost(user.estimatedCostUsd)} 30d ·{" "}
                              {formatCost(user.monthlyEstimatedCostUsd)} month · {formatCost(user.dailyEstimatedCostUsd)} today ·{" "}
                              {user.uploadCount.toLocaleString()} uploads · {formatFileSize(user.uploadBytes)} ·{" "}
                              {user.queryCount.toLocaleString()} queries · {user.failedQueryCount.toLocaleString()} blocked/failed ·{" "}
                              {user.chatSessionCount.toLocaleString()} chats
                            </small>
                          </span>
                        </div>
                        <span className="vc-artifact-shared">
                          {user.lastChatAt
                            ? `Chat ${new Date(user.lastChatAt).toLocaleDateString()}`
                            : user.lastUsedAt
                              ? `Model ${new Date(user.lastUsedAt).toLocaleDateString()}`
                              : "No activity"}
                        </span>
                      </article>
                    ))
                  ) : (
                    <div className="vc-preview-empty">No active account rows are available.</div>
                  )}
                </div>
              </>
            ) : (
              <div className="vc-preview-empty">{adminUsageLoaded ? "No usage rows yet." : "Loading usage..."}</div>
            )}
          </section>
        ) : null}

        <section className="vc-panel-card compact">
          <h2>Data modes</h2>
          <ul className="vc-mode-list">
            {protectedDatasetModes.map((mode) => {
              const Icon = mode.icon;
              return (
                <li key={mode.title}>
                  <Icon size={15} aria-hidden="true" />
                  <span>
                    <strong>{mode.title}</strong>
                    {mode.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="vc-panel-card compact">
          <h2>Snapshot tables</h2>
          <ul className="vc-mode-list">
            {wardSnapshotDataSources.map(([table, purpose]) => (
              <li key={table}>
                <FileText size={15} aria-hidden="true" />
                <span>
                  <strong>{table}</strong>
                  {purpose}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {session.role === "admin" ? (
          <section className="vc-panel-card compact">
            <h2>Model routing</h2>
            <ul className="vc-mode-list">
              {modelRoutingRows.slice(0, 3).map((row) => {
                const Icon = row.icon;
                return (
                  <li key={row.label}>
                    <Icon size={15} aria-hidden="true" />
                    <span>
                      <strong>{row.label}: {row.model}</strong>
                      {row.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <section className="vc-panel-card compact">
            <h2>Automatic routing</h2>
            <p>
              The portal chooses the right Foundry route for each CE workflow, query,
              notebook starter, or review task. Interns do not need model names, API
              keys, or deployment settings.
            </p>
          </section>
        )}
      </aside>
      ) : null}
    </div>
  );
}
