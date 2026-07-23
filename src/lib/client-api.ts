type ApiResponseShape = {
  success?: boolean;
  error?: string;
  data?: unknown;
};

function messageForStatus(status: number, fallbackMessage: string) {
  if (status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (status === 403) return "Bạn chưa được cấp quyền xem dữ liệu này.";
  if (status === 404) return "Chức năng này chưa sẵn sàng. Vui lòng tải lại trang.";
  if (status >= 500) return "Máy chủ đang gặp sự cố. Vui lòng thử lại sau.";
  return fallbackMessage;
}

export async function readApiResponse<T extends ApiResponseShape>(
  response: Response,
  fallbackMessage: string
): Promise<T> {
  const text = await response.text();

  if (!text) {
    throw new Error(messageForStatus(response.status, fallbackMessage));
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(messageForStatus(response.status, fallbackMessage));
  }
}
