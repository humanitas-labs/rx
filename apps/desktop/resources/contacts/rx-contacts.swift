// rx-contacts: prints the local address book as JSON on stdout and exits.
//
// Official Contacts framework only (CNContactStore, ADR-005). Read-only, no
// arguments, no network. The first run triggers the macOS Contacts consent
// prompt, attributed to the responsible (parent) application.
//
// Output shape:
//   {"granted": Bool, "contacts": [{"name": String,
//                                   "phones": [String], "emails": [String]}]}

import Contacts
import Foundation

func emit(_ object: [String: Any]) -> Never {
  guard let data = try? JSONSerialization.data(withJSONObject: object) else {
    FileHandle.standardOutput.write(Data("{\"granted\":false,\"contacts\":[]}".utf8))
    exit(1)
  }
  FileHandle.standardOutput.write(data)
  exit(0)
}

let store = CNContactStore()
let gate = DispatchSemaphore(value: 0)
var granted = false
store.requestAccess(for: .contacts) { ok, _ in
  granted = ok
  gate.signal()
}
gate.wait()

guard granted else { emit(["granted": false, "contacts": []]) }

let keys: [CNKeyDescriptor] = [
  CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
  CNContactOrganizationNameKey as CNKeyDescriptor,
  CNContactPhoneNumbersKey as CNKeyDescriptor,
  CNContactEmailAddressesKey as CNKeyDescriptor,
]

var contacts: [[String: Any]] = []
let request = CNContactFetchRequest(keysToFetch: keys)
do {
  try store.enumerateContacts(with: request) { contact, _ in
    let formatted = CNContactFormatter.string(from: contact, style: .fullName)
    let organization = contact.organizationName.trimmingCharacters(in: .whitespaces)
    guard let name = formatted ?? (organization.isEmpty ? nil : organization) else {
      return
    }
    contacts.append([
      "name": name,
      "phones": contact.phoneNumbers.map { $0.value.stringValue },
      "emails": contact.emailAddresses.map { $0.value as String },
    ])
  }
} catch {
  // Partial data is worse than none: report an empty, granted snapshot.
  emit(["granted": true, "contacts": []])
}

emit(["granted": true, "contacts": contacts])
