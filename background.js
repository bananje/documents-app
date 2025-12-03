chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "openDriveWindow") {
    // Создаем минималистичное окно без адресной строки и тулбара
    chrome.windows.create(
      {
        url: msg.url,
        type: "popup", // popup создает окно без адресной строки и некоторых элементов интерфейса
        left: msg.left,
        top: msg.top,
        width: msg.width,
        height: msg.height,
        focused: true,
      },
      (win) => {
        if (win && win.id) {
          // Множественные попытки вывести окно на передний план
          const bringToFront = (attempt = 1) => {
            if (attempt > 3) return; // Максимум 3 попытки

            setTimeout(() => {
              chrome.windows.update(
                win.id,
                {
                  focused: true,
                  drawAttention: true,
                },
                () => {
                  if (chrome.runtime.lastError) {
                    console.warn(`Attempt ${attempt} failed:`, chrome.runtime.lastError.message);
                    if (attempt < 3) {
                      bringToFront(attempt + 1);
                    }
                  } else {
                    // Успешно вывели на передний план
                    console.log(`Window ${win.id} brought to front on attempt ${attempt}`);
                  }
                },
              );
            }, attempt * 150); // 150ms, 300ms, 450ms
          };

          bringToFront();
        }
      },
    );
    return true; // Асинхронный ответ
  }
});
  