FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
COPY web ./web
RUN CGO_ENABLED=0 go build -trimpath -o /axis .
FROM alpine:3.23
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 axis
COPY --from=build /axis /usr/local/bin/axis
USER axis
ENV PORT=8080
EXPOSE 8080
CMD ["axis"]
