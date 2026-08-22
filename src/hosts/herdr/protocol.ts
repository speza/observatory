import { Schema } from "effect";

/** JSON values accepted from a host protocol after runtime validation. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonRecord;

export interface JsonRecord {
  readonly [key: string]: JsonValue;
}

const JsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(JsonValueSchema),
    Schema.Record({ key: Schema.String, value: JsonValueSchema }),
  ),
);

const JsonRecordSchema: Schema.Schema<JsonRecord> = Schema.Record({
  key: Schema.String,
  value: JsonValueSchema,
});

export const isRecord = (value: JsonValue | undefined): value is JsonRecord =>
  value !== undefined && Schema.is(JsonRecordSchema)(value);

export const stringValue = (record: JsonRecord, key: string): string | undefined => {
  const value = record[key];
  return Schema.is(Schema.String)(value) && value.length > 0 ? value : undefined;
};

export const numberValue = (record: JsonRecord, ...keys: readonly string[]): number | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (Schema.is(Schema.Number)(value) && Number.isFinite(value)) return value;
  }
  return undefined;
};

export const parseJsonValue = (text: string): JsonValue | undefined => {
  try {
    return Schema.decodeUnknownSync(Schema.parseJson(JsonValueSchema))(text);
  } catch {
    return undefined;
  }
};

export const nonEmptyRecord = (value: JsonValue | undefined): JsonRecord =>
  isRecord(value) ? value : {};
