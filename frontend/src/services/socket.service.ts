// frontend/src/services/socket.service.ts

import { io, Socket } from "socket.io-client";

class SocketService {
  private socket: Socket | null = null;
  private messageHandlers: Set<(message: any) => void> = new Set();

  connect(userId: string): Socket {
    if (this.socket?.connected) {
      console.log("🔌 [SOCKET] Já conectado, reutilizando conexão");
      return this.socket;
    }

    console.log("🔌 [SOCKET] Conectando ao servidor WebSocket...");
    console.log("  User ID:", userId);

    this.socket = io("http://localhost:3000", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    // Evento: conectado
    this.socket.on("connect", () => {
      console.log("[SOCKET] Conectado ao servidor");
      console.log("  Socket ID:", this.socket?.id);

      // Registrar usuário
      this.socket?.emit("register", userId);
      console.log("📝 [SOCKET] Usuário registrado:", userId);
    });

    // Evento: erro de conexão
    this.socket.on("connect_error", (error) => {
      console.error("[SOCKET] Erro de conexão:", error.message);
    });

    // Evento: desconectado
    this.socket.on("disconnect", (reason) => {
      console.log("🔌 [SOCKET] Desconectado:", reason);

      if (reason === "io server disconnect") {
        // Servidor desconectou, reconectar manualmente
        this.socket?.connect();
      }
    });

    // Evento: mensagem recebida
    this.socket.on("message:receive", (message) => {
      console.log("[SOCKET] Nova mensagem recebida via WebSocket");
      console.log("  De:", message.senderId);
      console.log(
        "  Dados cifrados (primeiros 50):",
        message.encryptedData?.substring(0, 50)
      );

      // Notificar todos os handlers registrados
      this.messageHandlers.forEach((handler) => {
        try {
          handler(message);
        } catch (error) {
          console.error("[SOCKET] Erro ao processar mensagem:", error);
        }
      });
    });

    return this.socket;
  }

  // Adicionar handler para mensagens recebidas
  onMessage(handler: (message: any) => void): () => void {
    console.log("👂 [SOCKET] Registrando listener de mensagens");
    this.messageHandlers.add(handler);

    // Retornar função para remover o handler
    return () => {
      console.log("🔇 [SOCKET] Removendo listener de mensagens");
      this.messageHandlers.delete(handler);
    };
  }

  disconnect() {
    if (this.socket) {
      console.log("🔌 [SOCKET] Desconectando...");
      this.messageHandlers.clear();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}

export default new SocketService();
