package com.giaokhoa.shared.http;

import org.springframework.http.HttpStatus;

public class HttpProblemException extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    public HttpProblemException(HttpStatus status, String code, String safeDetail) {
        super(safeDetail);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() { return status; }
    public String getCode() { return code; }
}
