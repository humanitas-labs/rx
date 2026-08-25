// rx-contacts: prints the local address book as JSON on stdout and exits.
//
// Official Contacts framework only (CNContactStore, ADR-005). Read-only, no
// arguments, no network. The first run triggers the macOS Contacts consent
// prompt, attributed to the responsible (parent) application.
//
// Output shape:
//   {"granted": Bool, "contacts": [{"name": String,
//                                   "phones": [String], "emails": [String],
//                                   "photo": String?}]}
//
// `photo` is a base64 JPEG avatar, present only for cards that carry an
// image. Contacts' own "thumbnail" runs to a megabyte on some cards, so it is
// re-encoded here at avatar size rather than shipped whole.

import Contacts
import Foundation
import ImageIO
import UniformTypeIdentifiers

/** Avatars render at 40 pt; 128 px covers 2x with room to spare. */
let avatarMaxPixels = 128

/** Re-encode an image blob as a small square-ish JPEG. Nil if undecodable. */
func avatarJpeg(from data: Data) -> Data? {
  guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
    return nil
  }
  let options: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: avatarMaxPixels,
  ]
  guard
    let scaled = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
    let output = CFDataCreateMutable(nil, 0),
    let destination = CGImageDestinationCreateWithData(
      output, UTType.jpeg.identifier as CFString, 1, nil)
  else {
    return nil
  }
  CGImageDestinationAddImage(
    destination, scaled, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
  guard CGImageDestinationFinalize(destination) else {
    return nil
  }
  return output as Data
}

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
  CNContactThumbnailImageDataKey as CNKeyDescriptor,
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
    var card: [String: Any] = [
      "name": name,
      "phones": contact.phoneNumbers.map { $0.value.stringValue },
      "emails": contact.emailAddresses.map { $0.value as String },
    ]
    if let thumbnail = contact.thumbnailImageData, let avatar = avatarJpeg(from: thumbnail) {
      card["photo"] = avatar.base64EncodedString()
    }
    contacts.append(card)
  }
} catch {
  // Partial data is worse than none: report an empty, granted snapshot.
  emit(["granted": true, "contacts": []])
}

emit(["granted": true, "contacts": contacts])
