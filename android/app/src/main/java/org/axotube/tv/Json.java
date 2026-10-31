package org.axotube.tv;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal JSON reader and writer for the control server and config store.
 * It uses only java.util, so the same code runs on Android and on a host JVM.
 * Objects become LinkedHashMap, arrays become ArrayList, numbers become Double,
 * and JSON null becomes {@link #NULL} (never Java null), so a missing key and a
 * stored null stay distinct.
 */
final class Json {
    static final Object NULL = new Object() {
        @Override public String toString() { return "null"; }
    };

    private Json() { }

    static Object parse(String text) throws IOException {
        Parser parser = new Parser(text);
        Object value = parser.value();
        parser.skipWhitespace();
        if (!parser.atEnd()) throw new IOException("Trailing data after JSON value");
        return value;
    }

    /** Serialises a value. Map keys keep their insertion order. */
    static String write(Object value) {
        StringBuilder out = new StringBuilder();
        append(out, value, false);
        return out.toString();
    }

    /** Serialises with sorted keys, for comparing two configs for equality. */
    static String canonical(Object value) {
        StringBuilder out = new StringBuilder();
        append(out, value, true);
        return out.toString();
    }

    private static void append(StringBuilder out, Object value, boolean sortKeys) {
        if (value == null || value == NULL) {
            out.append("null");
        } else if (value instanceof String) {
            quote(out, (String) value);
        } else if (value instanceof Boolean) {
            out.append(((Boolean) value).booleanValue() ? "true" : "false");
        } else if (value instanceof Number) {
            appendNumber(out, ((Number) value).doubleValue());
        } else if (value instanceof Map) {
            Map<?, ?> map = (Map<?, ?>) value;
            List<Object> keys = new ArrayList<Object>(map.keySet());
            if (sortKeys) Collections.sort(keys, (a, b) -> String.valueOf(a).compareTo(String.valueOf(b)));
            out.append('{');
            boolean first = true;
            for (Object key : keys) {
                if (!first) out.append(',');
                first = false;
                quote(out, String.valueOf(key));
                out.append(':');
                append(out, map.get(key), sortKeys);
            }
            out.append('}');
        } else if (value instanceof List) {
            out.append('[');
            boolean first = true;
            for (Object item : (List<?>) value) {
                if (!first) out.append(',');
                first = false;
                append(out, item, sortKeys);
            }
            out.append(']');
        } else {
            quote(out, value.toString());
        }
    }

    private static void appendNumber(StringBuilder out, double d) {
        if (Double.isNaN(d) || Double.isInfinite(d)) {
            out.append("null");
        } else if (d == Math.rint(d) && Math.abs(d) < 1e15) {
            out.append((long) d);
        } else {
            out.append(Double.toString(d));
        }
    }

    private static void quote(StringBuilder out, String text) {
        out.append('"');
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                case '\b': out.append("\\b"); break;
                case '\f': out.append("\\f"); break;
                default:
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
            }
        }
        out.append('"');
    }

    private static final class Parser {
        private final String s;
        private int i;

        Parser(String text) {
            this.s = text;
        }

        boolean atEnd() {
            return i >= s.length();
        }

        void skipWhitespace() {
            while (i < s.length()) {
                char c = s.charAt(i);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') i++;
                else break;
            }
        }

        Object value() throws IOException {
            skipWhitespace();
            if (atEnd()) throw new IOException("Unexpected end of JSON");
            char c = s.charAt(i);
            if (c == '{') return object();
            if (c == '[') return array();
            if (c == '"') return string();
            if (c == 't') return literal("true", Boolean.TRUE);
            if (c == 'f') return literal("false", Boolean.FALSE);
            if (c == 'n') return literal("null", NULL);
            if (c == '-' || (c >= '0' && c <= '9')) return number();
            throw new IOException("Unexpected character in JSON");
        }

        private Object literal(String word, Object value) throws IOException {
            if (!s.startsWith(word, i)) throw new IOException("Bad JSON literal");
            i += word.length();
            return value;
        }

        private Map<String, Object> object() throws IOException {
            Map<String, Object> map = new LinkedHashMap<String, Object>();
            i++;
            skipWhitespace();
            if (!atEnd() && s.charAt(i) == '}') { i++; return map; }
            while (true) {
                skipWhitespace();
                if (atEnd() || s.charAt(i) != '"') throw new IOException("Expected object key");
                String key = string();
                skipWhitespace();
                if (atEnd() || s.charAt(i) != ':') throw new IOException("Expected ':'");
                i++;
                map.put(key, value());
                skipWhitespace();
                if (atEnd()) throw new IOException("Unterminated object");
                char c = s.charAt(i++);
                if (c == '}') return map;
                if (c != ',') throw new IOException("Expected ',' or '}'");
            }
        }

        private List<Object> array() throws IOException {
            List<Object> list = new ArrayList<Object>();
            i++;
            skipWhitespace();
            if (!atEnd() && s.charAt(i) == ']') { i++; return list; }
            while (true) {
                list.add(value());
                skipWhitespace();
                if (atEnd()) throw new IOException("Unterminated array");
                char c = s.charAt(i++);
                if (c == ']') return list;
                if (c != ',') throw new IOException("Expected ',' or ']'");
            }
        }

        private String string() throws IOException {
            StringBuilder out = new StringBuilder();
            i++;
            while (true) {
                if (atEnd()) throw new IOException("Unterminated string");
                char c = s.charAt(i++);
                if (c == '"') return out.toString();
                if (c != '\\') { out.append(c); continue; }
                if (atEnd()) throw new IOException("Bad escape");
                char e = s.charAt(i++);
                switch (e) {
                    case '"': out.append('"'); break;
                    case '\\': out.append('\\'); break;
                    case '/': out.append('/'); break;
                    case 'b': out.append('\b'); break;
                    case 'f': out.append('\f'); break;
                    case 'n': out.append('\n'); break;
                    case 'r': out.append('\r'); break;
                    case 't': out.append('\t'); break;
                    case 'u':
                        if (i + 4 > s.length()) throw new IOException("Bad unicode escape");
                        out.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                        i += 4;
                        break;
                    default: throw new IOException("Bad escape");
                }
            }
        }

        private Double number() throws IOException {
            int start = i;
            if (s.charAt(i) == '-') i++;
            while (i < s.length() && "0123456789.eE+-".indexOf(s.charAt(i)) >= 0) i++;
            try {
                return Double.valueOf(s.substring(start, i));
            } catch (NumberFormatException e) {
                throw new IOException("Bad number");
            }
        }
    }
}
