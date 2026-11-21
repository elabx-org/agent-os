import Foundation

// Codable mirrors of what this Mac's AgentOS answers. Every field the app
// can do without is optional, so a server that adds or drops one still
// decodes.

/// true/false, or SQLite's 1/0
struct FlexBool: Codable, Equatable {
  let value: Bool
  init(_ value: Bool) { self.value = value }
  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if let b = try? c.decode(Bool.self) {
      value = b
    } else if let n = try? c.decode(Int.self) {
      value = n != 0
    } else {
      value = false
    }
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    try c.encode(value)
  }
}

/// /api/sessions/status → statuses[id]
struct StatusEntry: Codable, Equatable {
  var status: String
  var lastLine: String?
}

struct PromptOption: Codable, Equatable {
  var index: Int
  var label: String
  /// allow, always, deny or other
  var kind: String
}

/// Claude Code's selection prompt (lib/permission-prompt.ts)
struct PermissionPrompt: Codable, Equatable {
  var title: String
  var description: String
  var detail: String
  var question: String
  var options: [PromptOption]
  var selected: Int

  func first(_ kind: String) -> (position: Int, option: PromptOption)? {
    guard let i = options.firstIndex(where: { $0.kind == kind }) else { return nil }
    return (i, options[i])
  }
}

/// GET /api/sessions/<id>/prompt
struct PromptReply: Codable, Equatable {
  var prompt: PermissionPrompt?
  var fingerprint: String?
}

struct AskOption: Codable, Equatable {
  var label: String
  var description: String?
}

struct AskQuestion: Codable, Equatable {
  var question: String
  var header: String?
  var multiSelect: Bool?
  var options: [AskOption]
}

struct MessageChoice: Codable, Equatable {
  var label: String
  var reply: String
}

struct MessageChoices: Codable, Equatable {
  var question: String?
  var choices: [MessageChoice]
}

/// GET /api/sessions/<id>/reply-context → context
struct ReplyContext: Codable, Equatable {
  /// ask, permission, message or working
  var kind: String
  var question: String?
  var excerpt: String?
  var questions: [AskQuestion]?
  var onScreen: Bool?
  var choices: MessageChoices?
}

struct ReplyContextReply: Codable, Equatable {
  var context: ReplyContext?
}

/// GET /api/notifications → items
struct NotificationEntry: Codable, Equatable {
  var id: String
  var kind: String
  var title: String
  var body: String
  var sessionId: String?
  var projectName: String?
  /// ms since 1970
  var at: Int64
}

struct NotificationList: Codable, Equatable {
  var items: [NotificationEntry]
}

/// GET /api/projects → projects
struct Project: Codable, Equatable {
  var id: String
  var name: String
  var working_directory: String
  var agent_type: String?
  var default_model: String?
  var is_uncategorized: FlexBool?

  var uncategorized: Bool { is_uncategorized?.value ?? (id == "uncategorized") }
}

struct ProjectList: Codable, Equatable {
  var projects: [Project]
}

/// GET /api/build
struct BuildInfo: Codable, Equatable {
  var version: String?
  var features: [String]?
  var stub: Bool?

  /// Menu and notification answers need all three (fail closed)
  static let required = ["promptFingerprint", "replyGuard", "askLabels"]
  var answers: Bool { BuildInfo.hasAnswerFeatures(features) }
  static func hasAnswerFeatures(_ features: [String]?) -> Bool {
    guard let features else { return false }
    return required.allSatisfy(features.contains)
  }
}

enum Models {
  static func decode<T: Decodable>(_ type: T.Type, _ data: Data?) -> T? {
    guard let data else { return nil }
    return try? JSONDecoder().decode(type, from: data)
  }
}
