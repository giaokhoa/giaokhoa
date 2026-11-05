package com.giaokhoa.shared.http;

import org.springframework.http.HttpStatus;

public class HttpProblemException extends RuntimeException {
    private static final long serialVersionUID = 1L;
    private final HttpStatus status;
    private final String code;

    public HttpProblemException(HttpStatus status, String code, String safeDetail) {
        this(status, code, safeDetail, null);
    }

    public HttpProblemException(
            HttpStatus status, String code, String safeDetail, Throwable cause) {
        super(safeDetail, cause);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }
}
