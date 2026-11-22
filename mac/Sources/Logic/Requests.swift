import Foundation

struct NewSession: Equatable {
  var projectId: String
  var workingDirectory: String
  var agentType: String
  var model: String?
  var initialPrompt: String
}

enum PanelKind: Equatable {
  case reply(id: String, name: String)
  case askOther(id: String, name: String, question: String, optionCount: Int, labels: [String])
  case newSession
}

/// What a menu item does
enum MenuAction: Equatable {
  case answerPrompt(id: String, index: Int, label: String, fingerprint: String)
  case answerAsk(id: String, question: String, optionCount: Int, labels: [String], pick: Int)
  case askOther(id: String, question: String, optionCount: Int, labels: [String], text: String)
  case reply(id: String, text: String)
  case choice(id: String, reply: String)
  case interrupt(id: String)
  case stop(id: String)
  case newSession(NewSession)
  case open(id: String)
  case openPanel(PanelKind)
  /// The window on its home page ("and <n> more")
  case openHome
  /// The Notifications submenu: a toggle (needsYou, finished, limited), the
  /// first ask, System Settings
  case notifyToggle(String)
  case notifyAsk
  case notifySettings

  var sessionId: String? {
    switch self {
    case .answerPrompt(let id, _, _, _), .answerAsk(let id, _, _, _, _), .askOther(let id, _, _, _, _),
      .reply(let id, _), .choice(let id, _), .interrupt(let id), .stop(let id), .open(let id):
      return id
    case .openPanel(.reply(let id, _)), .openPanel(.askOther(let id, _, _, _, _)): return id
    default: return nil
    }
  }

  /// What a dump shows for an action that sends nothing
  var tag: String {
    switch self {
    case .open: return "open"
    case .openPanel(.reply): return "panel reply"
    case .openPanel(.askOther): return "panel askOther"
    case .openPanel(.newSession): return "panel newSession"
    case .openHome: return "open home"
    case .notifyToggle(let key): return "toggle \(key)"
    case .notifyAsk: return "ask permission"
    case .notifySettings: return "system settings"
    default: return name
    }
  }

  /// A short name for the action log (no text)
  var name: String {
    switch self {
    case .answerPrompt: return "answer"
    case .answerAsk: return "ask"
    case .askOther: return "askOther"
    case .reply: return "reply"
    case .choice: return "choice"
    case .interrupt: return "interrupt"
    case .stop: return "stop"
    case .newSession: return "newSession"
    default: return "other"
    }
  }
}

/// The request a menu action sends
struct PlannedRequest {
  let method: String
  let path: String
  let body: [String: Any]?
  let needsProof: Bool

  /// For `plan` and the tests: sorted keys
  var json: String {
    var all: [String: Any] = ["method": method, "path": path, "proof": needsProof]
    if let body { all["body"] = body }
    let data = (try? JSONSerialization.data(withJSONObject: all, options: [.sortedKeys])) ?? Data("{}".utf8)
    return String(decoding: data, as: UTF8.self)
  }
}

enum Requests {
  static func request(for a: MenuAction) -> PlannedRequest? {
    func session(_ id: String, _ tail: String) -> String? {
      SessionLink.isValidId(id) ? "/api/sessions/\(id)/\(tail)" : nil
    }
    switch a {
    case .answerPrompt(let id, let index, let label, let fingerprint):
      guard let path = session(id, "prompt") else { return nil }
      return PlannedRequest(
        method: "POST", path: path, body: ["index": index, "label": label, "fingerprint": fingerprint],
        needsProof: true)
    case .answerAsk(let id, let question, let optionCount, let labels, let pick):
      guard let path = session(id, "ask") else { return nil }
      return PlannedRequest(
        method: "POST", path: path,
        body: [
          "questions": [["question": question, "multiSelect": false, "optionCount": optionCount]],
          "answers": [["picks": [pick]]], "labels": [labels],
        ], needsProof: true)
    case .askOther(let id, let question, let optionCount, let labels, let text):
      guard let path = session(id, "ask") else { return nil }
      return PlannedRequest(
        method: "POST", path: path,
        body: [
          "questions": [["question": question, "multiSelect": false, "optionCount": optionCount]],
          "answers": [["picks": [Int](), "other": text] as [String: Any]], "labels": [labels],
        ], needsProof: true)
    case .reply(let id, let text):
      guard let path = session(id, "send-keys") else { return nil }
      return PlannedRequest(
        method: "POST", path: path, body: ["text": text, "pressEnter": true, "onlyIfNoPrompt": true],
        needsProof: true)
    case .choice(let id, let reply):
      guard let path = session(id, "send-keys") else { return nil }
      return PlannedRequest(
        method: "POST", path: path, body: ["text": reply, "pressEnter": true, "onlyIfNoPrompt": true],
        needsProof: true)
    case .interrupt(let id):
      guard let path = session(id, "interrupt") else { return nil }
      return PlannedRequest(method: "POST", path: path, body: nil, needsProof: false)
    case .stop(let id):
      guard let path = session(id, "stop") else { return nil }
      return PlannedRequest(method: "POST", path: path, body: nil, needsProof: false)
    case .newSession(let n):
      // Never autoApprove or permissionMode: the menu can't grant Full access
      var body: [String: Any] = [
        "projectId": n.projectId, "workingDirectory": n.workingDirectory, "agentType": n.agentType,
        "initialPrompt": n.initialPrompt, "launch": true,
      ]
      if let model = n.model { body["model"] = model }
      return PlannedRequest(method: "POST", path: "/api/sessions", body: body, needsProof: false)
    case .open, .openPanel, .openHome, .notifyToggle, .notifyAsk, .notifySettings:
      return nil
    }
  }
}
