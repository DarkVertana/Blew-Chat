// Fictional data for the frontend-only chat UI. Replace with API data later.

export type MessageStatus = "sent" | "delivered" | "read";

export type Chat = {
  id: string;
  name: string;
  initials: string;
  color: string;
  preview: string;
  time: string;
  unread?: number;
  group?: boolean;
  favourite?: boolean;
  online?: boolean;
  /** The last message was sent by the signed-in user. */
  lastFromMe?: boolean;
  status?: MessageStatus;
  attachment?: "document" | "image" | "audio";
  /** Contact info: phone number (contacts only). */
  phone?: string;
  /** Contact info: the about line, or the description for groups. */
  about?: string;
  /** Group info: member count. */
  members?: number;
  /** Contact info: total shared media, links and docs. */
  media?: number;
};

export type Message = {
  id: string;
  from: "me" | "them";
  text: string;
  time: string;
  status?: MessageStatus;
  /** The message this one replies to, shown as a quote block inside the bubble. */
  quote?: { author: string; text: string };
};

/** A thumbnail in the "Media, links and docs" strip of the contact info panel. */
export type MediaItem = {
  id: string;
  kind: "image" | "document" | "link";
  /** File type or domain shown on document and link tiles. */
  label: string;
  /** Placeholder colour for image tiles. */
  tint: string;
};

export const chats: Chat[] = [
  { id: "1", name: "Aarav Sharma", initials: "AS", color: "#b45309", favourite: true, preview: "Project brief - Q4 roadmap.pdf", time: "7:05 PM", lastFromMe: true, status: "read", attachment: "document", online: true, phone: "+91 98200 11223", about: "Shipping things ⚙️", media: 71 },
  { id: "2", name: "+91 98765 43210", initials: "#", color: "#334155", preview: "*This one's only for early users* 😊 Your exclusive invite is here. Reply YES to claim it.", time: "6:52 PM", phone: "+91 98765 43210", about: "Available", media: 3 },
  { id: "3", name: "Design Team", initials: "DT", color: "#0284c7", group: true, favourite: true, preview: "Meera: env value details : API_URL=https://api.example.com", time: "6:32 PM", lastFromMe: true, status: "delivered", members: 8, about: "Figma links, reviews and handoffs", media: 128 },
  { id: "4", name: "Telecom Care", initials: "TC", color: "#dc2626", preview: "Dear Valued Customer, your broadband bill payment of ₹899 is due on 3 Oct.", time: "4:39 PM", phone: "+91 1800 345 1500", about: "Official customer care · Mon–Sat, 9 am–6 pm", media: 12 },
  { id: "5", name: "Finance Desk", initials: "FD", color: "#2563eb", preview: "Video KYC Update! Complete your KYC before 30 Sep to keep your account active.", time: "3:36 PM", unread: 2, phone: "+91 22 6600 1234", about: "Verified business account", media: 4 },
  { id: "6", name: "Mom", initials: "M", color: "#db2777", favourite: true, preview: "Call me when you're free 🙂", time: "2:43 PM", unread: 1, phone: "+91 98220 55443", about: "Family first ❤️", media: 214 },
  { id: "7", name: "Novel - Website (External)", initials: "NW", color: "#0891b2", group: true, preview: "Vikas: All were done", time: "1:42 PM", members: 5, about: "Client group for the Novel website build", media: 39 },
  { id: "8", name: "Riya Patel", initials: "RP", color: "#7c3aed", preview: "Voice message (0:42)", time: "12:10 PM", attachment: "audio", phone: "+91 99870 12345", about: "At the gym 🏋️", media: 26 },
  { id: "9", name: "Weekend Trek 🏔️", initials: "WT", color: "#16a34a", group: true, preview: "Karan: Photo", time: "Yesterday", attachment: "image", members: 14, about: "Rajmachi this Saturday, 5:30 AM start", media: 302 },
  { id: "10", name: "Landlord", initials: "L", color: "#78716c", preview: "Received, thanks", time: "Yesterday", lastFromMe: true, status: "read", phone: "+91 98900 66778", about: "Available", media: 9 },
  { id: "11", name: "Dev Ops Alerts", initials: "DA", color: "#ea580c", group: true, preview: "Sam: deploy finished for api v1.4.2 ✅", time: "Sunday", members: 6, about: "Automated deploy and incident alerts", media: 0 },
  { id: "12", name: "Neha Iyer", initials: "NI", color: "#0f766e", preview: "Sure, Monday works for me", time: "Sunday", lastFromMe: true, status: "delivered", phone: "+91 97650 33221", about: "Busy", media: 18 },
];

const conversations: Record<string, Message[]> = {
  "1": [
    { id: "1-1", from: "them", text: "Hey! Did you get a chance to look at the roadmap doc?", time: "6:40 PM" },
    {
      id: "1-2",
      from: "me",
      text: "Yes, going through it now. The Q4 milestones look tight but doable.",
      time: "6:48 PM",
      status: "read",
      quote: { author: "Aarav Sharma", text: "Hey! Did you get a chance to look at the roadmap doc?" },
    },
    { id: "1-3", from: "them", text: "Agreed. Can you send the final brief so I can share it with the team?", time: "6:55 PM" },
    { id: "1-4", from: "me", text: "📄 Project brief - Q4 roadmap.pdf", time: "7:05 PM", status: "read" },
  ],
  "3": [
    { id: "3-1", from: "them", text: "Meera: Anyone has the staging env values?", time: "6:20 PM" },
    { id: "3-2", from: "me", text: "env value details : API_URL=https://api.example.com", time: "6:32 PM", status: "delivered" },
  ],
  "5": [
    { id: "5-1", from: "them", text: "Video KYC Update! Complete your KYC before 30 Sep to keep your account active.", time: "3:36 PM" },
    { id: "5-2", from: "them", text: "Reply HELP for assistance.", time: "3:36 PM" },
  ],
  "6": [
    { id: "6-1", from: "me", text: "Reached office, will call in the evening", time: "9:12 AM", status: "read" },
    { id: "6-2", from: "them", text: "Ok beta. Did you have breakfast?", time: "9:15 AM" },
    { id: "6-3", from: "me", text: "Yes 🙂", time: "9:16 AM", status: "read", quote: { author: "Mom", text: "Ok beta. Did you have breakfast?" } },
    { id: "6-4", from: "them", text: "👊👊👊", time: "9:17 AM" },
    { id: "6-5", from: "me", text: "😂😂", time: "9:18 AM", status: "read" },
    { id: "6-6", from: "them", text: "Call me when you're free 🙂", time: "2:43 PM" },
  ],
};

export function messagesFor(chatId: string): Message[] {
  const known = conversations[chatId];
  if (known) return known;
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) return [];
  return [{ id: `${chatId}-1`, from: chat.lastFromMe ? "me" : "them", text: chat.preview, time: chat.time, status: chat.status }];
}

const image = (id: string, tint: string): MediaItem => ({ id, kind: "image", label: "Photo", tint });
const document = (id: string, label: string): MediaItem => ({ id, kind: "document", label, tint: "" });
const link = (id: string, label: string): MediaItem => ({ id, kind: "link", label, tint: "" });

/** The four most recent items shown under "Media, links and docs". */
const media: Record<string, MediaItem[]> = {
  "1": [document("1-a", "PDF"), image("1-b", "#c2410c"), link("1-c", "example.com"), image("1-d", "#0e7490")],
  "2": [link("2-a", "invite.example"), image("2-b", "#4d7c0f")],
  "3": [image("3-a", "#0369a1"), document("3-b", "FIG"), link("3-c", "figma.com"), image("3-d", "#7e22ce")],
  "4": [document("4-a", "PDF"), link("4-b", "telecom.example"), image("4-c", "#be185d")],
  "5": [document("5-a", "PDF"), link("5-b", "finance.example")],
  "6": [image("6-a", "#be185d"), image("6-b", "#c2410c"), image("6-c", "#4d7c0f"), image("6-d", "#0369a1")],
  "7": [link("7-a", "novel.example"), document("7-b", "DOCX"), image("7-c", "#0e7490")],
  "8": [image("8-a", "#7e22ce"), image("8-b", "#be185d"), document("8-c", "PDF")],
  "9": [image("9-a", "#4d7c0f"), image("9-b", "#0369a1"), image("9-c", "#c2410c"), image("9-d", "#0e7490")],
  "10": [document("10-a", "PDF"), image("10-b", "#78716c")],
  "12": [link("12-a", "calendar.example"), image("12-b", "#0f766e")],
};

export function mediaFor(chatId: string): MediaItem[] {
  return media[chatId] ?? [];
}
