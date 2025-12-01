// frontend/src/pages/Chat.tsx - VERSÃO COMPLETA COM GRUPOS

import { useState, useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { CryptoService } from "../services/crypto.service";
import socketService from "../services/socket.service";
import { CreateGroup } from "../components/CreateGroup";
import { GroupChat } from "../components/GroupChat";

interface Chat {
  userId: string;
  name: string;
  email: string;
  publicKey: string;
  lastMessage?: string;
  lastMessageTime?: Date;
}

interface Group {
  id: string;
  name: string;
  description?: string;
  creatorId: string;
  myRole: string;
  myEncryptedGroupKey: string;
  myEphemeralPublicKey: string;
  myKeyVersion: number;
  _count: {
    members: number;
    messages: number;
  };
  members?: any[];
  creator: {
    id: string;
    name: string;
  };
}

interface Message {
  id: string;
  senderId: string;
  text: string;
  createdAt: Date;
  decrypted: boolean;
}

export function Chat() {
  const { user, privateKey, publicKeyRaw, logout } = useAuth();

  // Estado geral
  const [activeTab, setActiveTab] = useState<"chats" | "groups">("chats");
  const [socket, setSocket] = useState<any>(null);

  // Estado de chats 1-1
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);

  // Estado de grupos
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);

  // Modals
  const [showAddChat, setShowAddChat] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newChatEmail, setNewChatEmail] = useState("");
  const [addingChat, setAddingChat] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ========== INICIALIZAÇÃO ==========

  useEffect(() => {
    if (!user) return;

    console.log("🔌 [CHAT] Inicializando...");

    // Conectar WebSocket
    const sock = socketService.connect(user.id);
    setSocket(sock);

    // Listener para mensagens 1-1
    const unsubscribe = socketService.onMessage((data) => {
      if (data.receiverId === user.id && !data.groupId) {
        console.log("📨 [CHAT] Mensagem 1-1 recebida");
        decryptAndAddMessage(data);
      }
    });

    // Carregar chats e grupos
    loadUserChats();
    loadUserGroups();

    return () => {
      unsubscribe();
    };
  }, [user?.id]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ========== CHATS 1-1 ==========

  const loadUserChats = async () => {
    try {
      console.log("📜 [CHAT] Carregando lista de chats...");

      const response = await fetch(
        `http://localhost:3000/chat/user/${user!.id}/chats`
      );
      const data = await response.json();

      setChats(data);
      console.log(`✅ [CHAT] ${data.length} chats carregados`);
    } catch (error) {
      console.error("❌ [CHAT] Erro ao carregar chats:", error);
    }
  };

  const handleAddChat = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingChat(true);

    try {
      const response = await fetch(
        `http://localhost:3000/auth/user/email/${newChatEmail}`
      );

      if (!response.ok) {
        throw new Error("Usuário não encontrado");
      }

      const foundUser = await response.json();

      // Verificar se já existe
      const exists = chats.some((c) => c.userId === foundUser.id);
      if (exists) {
        alert("Você já tem uma conversa com este usuário");
        return;
      }

      // Adicionar à lista
      const newChat: Chat = {
        userId: foundUser.id,
        name: foundUser.name,
        email: foundUser.email,
        publicKey: foundUser.publicKey,
      };

      setChats((prev) => [...prev, newChat]);
      setNewChatEmail("");
      setShowAddChat(false);
      alert(`Chat com ${foundUser.name} adicionado!`);
    } catch (error: any) {
      alert("Erro: " + error.message);
    } finally {
      setAddingChat(false);
    }
  };

  const loadConversation = async (chat: Chat) => {
    setSelectedChat(chat);
    setSelectedGroup(null);
    setLoadingMessages(true);
    setMessages([]);

    try {
      console.log(`📜 [CHAT] Carregando conversa com ${chat.name}`);

      const response = await fetch(
        `http://localhost:3000/chat/conversations/${user!.id}/${chat.userId}`
      );
      const data = await response.json();

      console.log(`📜 [CHAT] ${data.length} mensagens encontradas`);

      const decryptedMessages: Message[] = [];

      for (const msg of data) {
        try {
          const isOutgoing = msg.senderId === user!.id;
          let decryptedText: string;

          if (isOutgoing) {
            // Mensagem que eu enviei
            if (
              !msg.senderEncryptedData ||
              !msg.senderNonce ||
              !msg.senderEphemPkForSelf
            ) {
              throw new Error(
                "Mensagem antiga sem criptografia para remetente"
              );
            }

            const myEphemPkRaw = CryptoService.base64ToArrayBuffer(
              msg.senderEphemPkForSelf
            );
            const myEphemPk = await CryptoService.importPublicKey(myEphemPkRaw);

            const sharedSecret = await CryptoService.computeSharedSecret(
              privateKey!,
              myEphemPk
            );

            const aesKey = await CryptoService.deriveAESKey(sharedSecret);

            decryptedText = await CryptoService.decryptMessage(
              msg.senderEncryptedData,
              msg.senderNonce,
              aesKey
            );
          } else {
            // Mensagem que recebi
            const senderEphemPkRaw = CryptoService.base64ToArrayBuffer(
              msg.senderEphemPk
            );
            const senderEphemPk = await CryptoService.importPublicKey(
              senderEphemPkRaw
            );

            const sharedSecret = await CryptoService.computeSharedSecret(
              privateKey!,
              senderEphemPk
            );

            const aesKey = await CryptoService.deriveAESKey(sharedSecret);

            decryptedText = await CryptoService.decryptMessage(
              msg.encryptedData,
              msg.nonce,
              aesKey
            );
          }

          decryptedMessages.push({
            id: msg.id,
            senderId: msg.senderId,
            text: decryptedText,
            createdAt: new Date(msg.createdAt),
            decrypted: true,
          });
        } catch (error) {
          console.error("❌ [CHAT] Erro ao descriptografar:", msg.id, error);
          decryptedMessages.push({
            id: msg.id,
            senderId: msg.senderId,
            text: "[Erro ao descriptografar]",
            createdAt: new Date(msg.createdAt),
            decrypted: false,
          });
        }
      }

      setMessages(decryptedMessages);
      console.log(`✅ [CHAT] ${decryptedMessages.length} mensagens carregadas`);
    } catch (error) {
      console.error("❌ [CHAT] Erro ao carregar conversa:", error);
    } finally {
      setLoadingMessages(false);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!messageInput.trim() || !selectedChat || !socket) return;

    setSendingMessage(true);

    try {
      console.log("📤 [CHAT] Enviando mensagem...");

      // Buscar chave pública do destinatário
      const response = await fetch(
        `http://localhost:3000/auth/user/${selectedChat.userId}`
      );
      if (!response.ok) throw new Error("Erro ao buscar destinatário");

      const receiver = await response.json();

      if (!receiver || !receiver.publicKey) {
        throw new Error("Destinatário não possui chave pública");
      }

      const receiverPublicKeyRaw = CryptoService.base64ToArrayBuffer(
        receiver.publicKey
      );
      const receiverPublicKey = await CryptoService.importPublicKey(
        receiverPublicKeyRaw
      );

      // CIFRAR PARA O DESTINATÁRIO
      const ephemeralKeysForReceiver = await CryptoService.generateKeyPair();
      const sharedSecretForReceiver = await CryptoService.computeSharedSecret(
        ephemeralKeysForReceiver.privateKey,
        receiverPublicKey
      );
      const aesKeyForReceiver = await CryptoService.deriveAESKey(
        sharedSecretForReceiver
      );
      const { encryptedData, nonce } = await CryptoService.encryptMessage(
        messageInput,
        aesKeyForReceiver
      );

      // CIFRAR PARA MIM MESMO
      const ephemeralKeysForSelf = await CryptoService.generateKeyPair();
      const myPublicKey = await CryptoService.importPublicKey(publicKeyRaw!);
      const sharedSecretForSelf = await CryptoService.computeSharedSecret(
        ephemeralKeysForSelf.privateKey,
        myPublicKey
      );
      const aesKeyForSelf = await CryptoService.deriveAESKey(
        sharedSecretForSelf
      );
      const { encryptedData: senderEncryptedData, nonce: senderNonce } =
        await CryptoService.encryptMessage(messageInput, aesKeyForSelf);

      // ENVIAR VIA WEBSOCKET
      socket.emit("message:send", {
        senderId: user!.id,
        receiverId: selectedChat.userId,
        encryptedData,
        nonce,
        senderEphemPk: CryptoService.arrayBufferToBase64(
          ephemeralKeysForReceiver.publicKeyRaw
        ),
        senderEncryptedData,
        senderNonce,
        senderEphemPkForSelf: CryptoService.arrayBufferToBase64(
          ephemeralKeysForSelf.publicKeyRaw
        ),
      });

      // Adicionar à lista local
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          senderId: user!.id,
          text: messageInput,
          createdAt: new Date(),
          decrypted: true,
        },
      ]);

      setMessageInput("");
      console.log("✅ [CHAT] Mensagem enviada");
    } catch (error: any) {
      console.error("❌ [CHAT] Erro ao enviar:", error);
      alert("Erro ao enviar mensagem: " + error.message);
    } finally {
      setSendingMessage(false);
    }
  };

  const decryptAndAddMessage = async (encryptedMessage: any) => {
    try {
      console.log("📨 [CHAT] Descriptografando mensagem...");

      if (!privateKey) {
        throw new Error("Chave privada não disponível");
      }

      const senderEphemPkRaw = CryptoService.base64ToArrayBuffer(
        encryptedMessage.senderEphemPk
      );
      const senderEphemPk = await CryptoService.importPublicKey(
        senderEphemPkRaw
      );

      const sharedSecret = await CryptoService.computeSharedSecret(
        privateKey,
        senderEphemPk
      );

      const aesKey = await CryptoService.deriveAESKey(sharedSecret);

      const decryptedText = await CryptoService.decryptMessage(
        encryptedMessage.encryptedData,
        encryptedMessage.nonce,
        aesKey
      );

      const message: Message = {
        id: encryptedMessage.id,
        senderId: encryptedMessage.senderId,
        text: decryptedText,
        createdAt: new Date(encryptedMessage.createdAt),
        decrypted: true,
      };

      setMessages((prev) => {
        const exists = prev.some((m) => m.id === message.id);
        if (exists) return prev;
        return [...prev, message];
      });

      // Atualizar lista de chats
      setChats((prevChats) =>
        prevChats.map((chat) => {
          if (chat.userId === encryptedMessage.senderId) {
            return {
              ...chat,
              lastMessage: decryptedText.substring(0, 50),
              lastMessageTime: new Date(),
            };
          }
          return chat;
        })
      );

      console.log("✅ [CHAT] Mensagem descriptografada");
    } catch (error) {
      console.error("❌ [CHAT] Erro ao descriptografar:", error);

      setMessages((prev) => [
        ...prev,
        {
          id: encryptedMessage.id || Date.now().toString(),
          senderId: encryptedMessage.senderId,
          text: "[Erro ao descriptografar]",
          createdAt: new Date(),
          decrypted: false,
        },
      ]);
    }
  };

  // ========== GRUPOS ==========

  const loadUserGroups = async () => {
    try {
      console.log("👥 [CHAT] Carregando grupos...");

      const response = await fetch(
        `http://localhost:3000/chat/user/${user!.id}/groups`
      );
      const data = await response.json();

      setGroups(data);
      console.log(`✅ [CHAT] ${data.length} grupos carregados`);
    } catch (error) {
      console.error("❌ [CHAT] Erro ao carregar grupos:", error);
    }
  };

  const handleGroupCreated = () => {
    loadUserGroups();
  };

  const selectGroup = (group: Group) => {
    setSelectedGroup(group);
    setSelectedChat(null);
  };

  const backToGroupList = () => {
    setSelectedGroup(null);
    loadUserGroups();
  };

  // ========== RENDER ==========

  if (!user) {
    return <div>Carregando...</div>;
  }

  // Se grupo selecionado, mostrar tela do grupo
  if (selectedGroup) {
    return <GroupChat group={selectedGroup} onBack={backToGroupList} />;
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* SIDEBAR */}
      <div className="w-80 bg-white border-r flex flex-col">
        {/* Header */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold">🔐 Chat Seguro</h2>
              <p className="text-sm text-gray-600">{user.name}</p>
            </div>
            <button
              onClick={logout}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Sair
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("chats")}
              className={`flex-1 py-2 rounded-lg font-semibold transition ${
                activeTab === "chats"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              💬 Chats
            </button>
            <button
              onClick={() => setActiveTab("groups")}
              className={`flex-1 py-2 rounded-lg font-semibold transition ${
                activeTab === "groups"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              👥 Grupos
            </button>
          </div>
        </div>

        {/* Lista de Chats ou Grupos */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "chats" ? (
            <>
              {/* Botão Adicionar Chat */}
              <div className="p-3">
                <button
                  onClick={() => setShowAddChat(true)}
                  className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  ➕ Adicionar Contato
                </button>
              </div>

              {/* Lista de Chats */}
              {chats.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  Nenhuma conversa ainda
                </div>
              ) : (
                chats.map((chat) => (
                  <div
                    key={chat.userId}
                    onClick={() => loadConversation(chat)}
                    className={`p-4 border-b cursor-pointer hover:bg-gray-50 ${
                      selectedChat?.userId === chat.userId ? "bg-blue-50" : ""
                    }`}
                  >
                    <div className="font-semibold">{chat.name}</div>
                    <div className="text-sm text-gray-600">{chat.email}</div>
                    {chat.lastMessage && (
                      <div className="text-xs text-gray-500 mt-1 truncate">
                        {chat.lastMessage}
                      </div>
                    )}
                  </div>
                ))
              )}
            </>
          ) : (
            <>
              {/* Botão Criar Grupo */}
              <div className="p-3">
                <button
                  onClick={() => setShowCreateGroup(true)}
                  className="w-full py-2 px-4 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  ➕ Criar Grupo
                </button>
              </div>

              {/* Lista de Grupos */}
              {groups.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  Você não está em nenhum grupo
                </div>
              ) : (
                groups.map((group) => (
                  <div
                    key={group.id}
                    onClick={() => selectGroup(group)}
                    className="p-4 border-b cursor-pointer hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{group.name}</div>
                      {group.myRole === "admin" && (
                        <span className="text-yellow-500 text-xs">👑</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-600">
                      {group._count.members} membros • {group._count.messages}{" "}
                      mensagens
                    </div>
                    {group.description && (
                      <div className="text-xs text-gray-500 mt-1 truncate">
                        {group.description}
                      </div>
                    )}
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>

      {/* ÁREA DE CHAT */}
      <div className="flex-1 flex flex-col">
        {selectedChat ? (
          <>
            {/* Header do Chat */}
            <div className="bg-white border-b p-4">
              <h2 className="text-xl font-semibold">{selectedChat.name}</h2>
              <p className="text-sm text-gray-600">{selectedChat.email}</p>
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loadingMessages ? (
                <div className="text-center text-gray-500">
                  Carregando mensagens...
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center text-gray-500">
                  Nenhuma mensagem ainda. Envie a primeira!
                </div>
              ) : (
                messages.map((msg) => {
                  const isMe = msg.senderId === user.id;

                  return (
                    <div
                      key={msg.id}
                      className={`flex ${
                        isMe ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[70%] rounded-lg px-4 py-2 ${
                          isMe
                            ? "bg-blue-600 text-white"
                            : "bg-white border border-gray-200"
                        }`}
                      >
                        <div
                          className={msg.decrypted ? "" : "text-red-500 italic"}
                        >
                          {msg.text}
                        </div>
                        <div
                          className={`text-xs mt-1 ${
                            isMe ? "text-blue-100" : "text-gray-500"
                          }`}
                        >
                          {msg.createdAt.toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={sendMessage} className="bg-white border-t p-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder="Digite sua mensagem..."
                  className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={sendingMessage}
                />
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
                  disabled={sendingMessage || !messageInput.trim()}
                >
                  {sendingMessage ? "..." : "📤"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            {activeTab === "chats"
              ? "Selecione uma conversa para começar"
              : "Selecione um grupo ou crie um novo"}
          </div>
        )}
      </div>

      {/* MODALS */}
      {showAddChat && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Adicionar Contato</h2>
            <form onSubmit={handleAddChat} className="space-y-4">
              <input
                type="email"
                value={newChatEmail}
                onChange={(e) => setNewChatEmail(e.target.value)}
                placeholder="Email do contato"
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                required
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddChat(false)}
                  className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  disabled={addingChat}
                >
                  {addingChat ? "Adicionando..." : "Adicionar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCreateGroup && (
        <CreateGroup
          onClose={() => setShowCreateGroup(false)}
          onGroupCreated={handleGroupCreated}
        />
      )}
    </div>
  );
}

