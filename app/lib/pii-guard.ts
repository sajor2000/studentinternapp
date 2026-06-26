import type { UIMessage } from "ai";

type PiiPattern = {
  category: string;
  pattern: RegExp;
  replacement: string;
};

export type PiiGuardResult =
  {
    messages: UIMessage[];
    categories: string[];
    masked: boolean;
  };

export type PiiTextGuardResult = {
  text: string;
  categories: string[];
  masked: boolean;
};

const directIdentifierPatterns: PiiPattern[] = [
  {
    category: "email address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    replacement: "[MASKED_EMAIL]",
  },
  {
    category: "phone number",
    pattern: /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/,
    replacement: "[MASKED_PHONE]",
  },
  {
    category: "SSN",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/,
    replacement: "[MASKED_SSN]",
  },
  {
    category: "medical record or account identifier",
    pattern:
      /\b(?:mrn|medical\s+record(?:\s+number)?|patient\s+id|member\s+id|account\s+number|subscriber\s+id)\b\s*[:=#-]?\s*[A-Z0-9][A-Z0-9-]{3,}\b/i,
    replacement: "[MASKED_PATIENT_IDENTIFIER]",
  },
  {
    category: "date of birth",
    pattern:
      /\b(?:dob|date\s+of\s+birth|birth\s+date)\b\s*[:=#-]?\s*(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/i,
    replacement: "[MASKED_DOB]",
  },
  {
    category: "patient name",
    pattern:
      /\b(?:patient|member|subject)\s+(?:name|full\s+name)\b\s*[:=#-]\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/,
    replacement: "[MASKED_PATIENT_NAME]",
  },
  {
    category: "street address",
    pattern:
      /\b\d{1,6}\s+[A-Z0-9][A-Z0-9.' -]{1,60}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl)\b/i,
    replacement: "[MASKED_ADDRESS]",
  },
  {
    category: "IP address",
    pattern:
      /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/,
    replacement: "[MASKED_IP]",
  },
];

const rowLevelIdentifierHeaderPattern =
  /\b(?:mrn|medical[_\s-]*record|patient[_\s-]*id|member[_\s-]*id|subscriber[_\s-]*id|dob|date[_\s-]*of[_\s-]*birth|full[_\s-]*name|first[_\s-]*name|last[_\s-]*name|address|phone|email)\b/i;

const identifierColumnMasks = [
  {
    category: "medical record or account identifier column",
    header: /^(?:mrn|medical[_\s-]*record(?:[_\s-]*number)?|patient[_\s-]*id|member[_\s-]*id|subscriber[_\s-]*id|account[_\s-]*number)$/i,
    replacement: "[MASKED_PATIENT_IDENTIFIER]",
  },
  {
    category: "date of birth column",
    header: /^(?:dob|date[_\s-]*of[_\s-]*birth|birth[_\s-]*date)$/i,
    replacement: "[MASKED_DOB]",
  },
  {
    category: "name column",
    header: /^(?:full[_\s-]*name|first[_\s-]*name|last[_\s-]*name|patient[_\s-]*name|member[_\s-]*name)$/i,
    replacement: "[MASKED_NAME]",
  },
  {
    category: "address column",
    header: /^(?:address|street[_\s-]*address|home[_\s-]*address|zip|zipcode|postal[_\s-]*code)$/i,
    replacement: "[MASKED_ADDRESS]",
  },
  {
    category: "contact column",
    header: /^(?:phone|phone[_\s-]*number|email|email[_\s-]*address)$/i,
    replacement: "[MASKED_CONTACT]",
  },
] as const;

export function getTextFromMessage(message: UIMessage): string {
  const partText = message.parts
    .map((part) => {
      if (part.type !== "text") {
        return "";
      }

      return part.text;
    })
    .join("\n");

  return partText.trim();
}

export function hasPastedRowLevelExtract(text: string): boolean {
  if (!rowLevelIdentifierHeaderPattern.test(text)) {
    return false;
  }

  const csvLikeLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const commaCount = (line.match(/,/g) ?? []).length;
      const tabCount = (line.match(/\t/g) ?? []).length;

      return commaCount >= 2 || tabCount >= 2;
    });

  return csvLikeLines.length >= 2;
}

function maskText(text: string, categories: Set<string>): string {
  return directIdentifierPatterns.reduce((currentText, { category, pattern, replacement }) => {
    if (!pattern.test(currentText)) {
      return currentText;
    }

    categories.add(category);
    return currentText.replace(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`), replacement);
  }, text);
}

function getDelimiter(line: string): "," | "\t" | null {
  if ((line.match(/,/g) ?? []).length >= 2) {
    return ",";
  }

  if ((line.match(/\t/g) ?? []).length >= 2) {
    return "\t";
  }

  return null;
}

function getIdentifierColumnIndexes(headerLine: string, delimiter: "," | "\t", categories: Set<string>) {
  const headers = headerLine.split(delimiter).map((header) => header.trim().replace(/^["']|["']$/g, ""));
  const masks = new Map<number, string>();

  headers.forEach((header, index) => {
    const mask = identifierColumnMasks.find((candidate) => candidate.header.test(header));

    if (mask) {
      masks.set(index, mask.replacement);
      categories.add(mask.category);
    }
  });

  return masks;
}

function maskDelimitedIdentifierColumns(text: string, categories: Set<string>): string {
  const lines = text.split(/\r?\n/);
  const outputLines = [...lines];
  let index = 0;

  while (index < lines.length) {
    const delimiter = getDelimiter(lines[index]);

    if (!delimiter || !rowLevelIdentifierHeaderPattern.test(lines[index])) {
      index += 1;
      continue;
    }

    const masks = getIdentifierColumnIndexes(lines[index], delimiter, categories);

    if (masks.size === 0) {
      index += 1;
      continue;
    }

    index += 1;

    while (index < lines.length) {
      const line = lines[index];
      const rowDelimiter = getDelimiter(line);

      if (!line.trim() || rowDelimiter !== delimiter) {
        break;
      }

      const cells = line.split(delimiter);

      for (const [cellIndex, replacement] of masks.entries()) {
        if (cellIndex < cells.length && cells[cellIndex].trim()) {
          cells[cellIndex] = replacement;
        }
      }

      outputLines[index] = cells.join(delimiter);
      index += 1;
    }
  }

  return outputLines.join("\n");
}

function maskPiiTextWithCategories(text: string, categories: Set<string>): string {
  return maskText(maskDelimitedIdentifierColumns(text, categories), categories);
}

export function maskPiiText(text: string): PiiTextGuardResult {
  const categories = new Set<string>();
  const maskedText = maskPiiTextWithCategories(text, categories);

  return {
    text: maskedText,
    categories: [...categories],
    masked: categories.size > 0,
  };
}

function maskMessage(message: UIMessage, categories: Set<string>): UIMessage {
  let changed = false;
  const parts = message.parts.map((part) => {
    if (part.type !== "text") {
      return part;
    }

    const maskedText = maskPiiTextWithCategories(part.text, categories);

    if (maskedText !== part.text) {
      changed = true;
    }

    return {
      ...part,
      text: maskedText,
    };
  });

  if (!changed) {
    return message;
  }

  return {
    ...message,
    parts,
  } as UIMessage;
}

export function inspectMessagesForPii(messages: UIMessage[]): PiiGuardResult {
  const messageText = messages
    .map(getTextFromMessage)
    .filter(Boolean)
    .join("\n\n");

  if (!messageText) {
    return { messages, categories: [], masked: false };
  }

  const categories = new Set<string>();
  const maskedMessages = messages.map((message) => maskMessage(message, categories));

  return {
    messages: maskedMessages,
    categories: [...categories],
    masked: categories.size > 0,
  };
}
