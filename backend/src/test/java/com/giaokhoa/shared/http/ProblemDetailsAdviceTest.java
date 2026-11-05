package com.giaokhoa.shared.http;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

class ProblemDetailsAdviceTest {
    private MockMvc mvc;

    @RestController
    static class Probe {
        record Payload(@NotBlank String name) {}

        @PostMapping("/probe")
        void validate(@RequestHeader("If-Match") String ifMatch, @Valid @RequestBody Payload payload) {}

        @PostMapping("/pending")
        void unavailable() {
            throw new HttpProblemException(HttpStatus.SERVICE_UNAVAILABLE,
                    "PROJECTION_PENDING", "Đồng bộ quyền đang xử lý.");
        }

        @PostMapping("/query")
        void invalidParam(@RequestParam @NotBlank String code) {}

        @PostMapping("/forbidden")
        void forbidden() { throw new AccessDeniedException("internal security details"); }

        @PostMapping("/unauthorized")
        void unauthorized() { throw new BadCredentialsException("secret credentials"); }

        @PostMapping("/internal")
        void unexpected() {
            throw new IllegalArgumentException("credential super-secret must not appear");
        }
    }

    @BeforeEach
    void setup() {
        mvc = MockMvcBuilders.standaloneSetup(new Probe())
                .setControllerAdvice(new ProblemDetailsAdvice()).build();
    }

    @Test
    void missingIfMatchReturns428WithNoCacheAndTrace() throws Exception {
        mvc.perform(post("/probe").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"ok\"}"))
                .andExpect(status().isPreconditionRequired())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(header().string("Cache-Control", "private, no-store"))
                .andExpect(jsonPath("$.status").value(428))
                .andExpect(jsonPath("$.code").value("PRECONDITION_REQUIRED"))
                .andExpect(jsonPath("$.instance").value("/probe"))
                .andExpect(jsonPath("$.traceId").isNotEmpty());
    }

    @Test
    void invalidFieldProducesSafeViolationsWithoutRejectedData() throws Exception {
        mvc.perform(post("/probe").header("If-Match", "\"0\"")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.violations[0].field").value("name"))
                .andExpect(jsonPath("$.violations[0].code").value("NotBlank"))
                .andExpect(jsonPath("$.violations[0].message").value("Giá trị không hợp lệ."));
    }

    @Test
    void projectionPendingReturns503WithoutSecrets() throws Exception {
        mvc.perform(post("/pending"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("PROJECTION_PENDING"));
    }

    @Test
    void methodValidationIncludesFieldViolation() throws Exception {
        mvc.perform(post("/query").param("code", ""))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.violations[0].field").value("code"))
                .andExpect(jsonPath("$.violations[0].message").value("Giá trị không hợp lệ."));
    }

    @Test
    void accessFailuresHaveStableCodes() throws Exception {
        mvc.perform(post("/forbidden"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        mvc.perform(post("/unauthorized"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void unexpectedErrorDoesNotEchoException() throws Exception {
        mvc.perform(post("/internal"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.detail").value("Không thể xử lý yêu cầu."))
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));
    }
}
